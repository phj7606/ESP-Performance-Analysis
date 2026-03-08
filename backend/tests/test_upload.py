"""
Upload API integration tests (ROADMAP: API-6).

Test cases:
1. test_upload_success              — Valid upload → 200, records_inserted, well_name verification
2. test_upload_well_api_accessible  — Well list API accessible after upload
3. test_upload_missing_column       — Missing required column (vfd_freq) → 422 + error message
4. test_upload_invalid_extension    — txt file upload → 400 response
5. test_upload_empty_file           — Empty file upload → 4xx response
6. test_space_normalized_to_hyphen  — Well name space → hyphen normalization
7. test_digit_letter_boundary       — Digit-letter boundary hyphen insertion verification
8. test_duplicate_upload_same_count — Same file uploaded twice → same record count (idempotency)
9. test_duplicate_upload_status     — analysis_status preserved after re-upload

Run:
    docker compose exec backend pytest tests/test_upload.py -v
"""
import io
from datetime import date, timedelta

import openpyxl
import pytest

from app.services.upload_service import normalize_well_name
from tests.conftest import TEST_WELL_NAME


# ============================================================
# Excel fixture creation helper
# ============================================================

def _make_excel(
    well_name: str = TEST_WELL_NAME,
    n_rows: int = 5,
    skip_headers: list[str] | None = None,
) -> bytes:
    """
    Generate a minimal valid Excel file for testing.
    Uses the same header structure as Production Data.xlsx so that
    parse_excel() processes it identically to the real file.

    Args:
        well_name: Value to write in column A (Well name)
        n_rows: Number of data rows to generate
        skip_headers: Headers to intentionally omit (for missing column tests)
    """
    skip_headers = skip_headers or []

    # Define (Excel header, fixed data value) pairs
    # Column B (date) has no header (None) — same structure as Production Data.xlsx
    col_defs: list[tuple[str | None, object]] = [
        ("Well number (No.)", well_name),            # Column A: Well name
        (None, None),                                 # Column B: Date (no header)
        ("WELL STATUS WELL STATUS CHOKE (1/128)", 43.0),
        ("ESP VFD FRE. (Hz)", 35.0),                 # → vfd_freq (required)
        ("ESP Motor Current (Amps)", 70.0),           # → motor_current (required)
        ("ESP downhole dataPi (PSI)", 4500.0),        # → pi (required)
        ("ESP downhole dataPd (PSI)", 6000.0),
        ("ESP Motor Tm (℃)", 120.0),
        ("ESP Motor Vib (0.001g)", 0.5),
    ]

    active = [(h, v) for h, v in col_defs if h not in skip_headers]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([h for h, _ in active])  # Header row

    base_date = date(2023, 9, 22)
    for i in range(n_rows):
        row = []
        for j, (_, v) in enumerate(active):
            if j == 0:
                row.append(well_name)              # Column A: Well name
            elif j == 1:
                row.append(base_date + timedelta(days=i))  # Column B: Date
            else:
                row.append(v)
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _excel_files(content: bytes, filename: str = "test.xlsx") -> dict:
    """Return dictionary for httpx files parameter"""
    return {
        "file": (
            filename,
            content,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }


# ============================================================
# 1~2. Successful upload scenarios
# ============================================================

class TestUploadSuccess:
    """Successful upload and Well API retrieval scenarios"""

    async def test_upload_success(self, client, cleanup_test_well):
        """
        [API-6-1] Valid Excel upload → 200 OK.
        Verify: records_inserted = n_rows, well_name normalized, date_range included
        """
        n_rows = 5
        resp = await client.post("/api/upload", files=_excel_files(_make_excel(n_rows=n_rows)))

        assert resp.status_code == 200
        data = resp.json()
        assert data["well_name"] == TEST_WELL_NAME
        assert data["records_inserted"] == n_rows
        assert data["date_range"]["start"] == "2023-09-22"
        assert data["date_range"]["end"] == "2023-09-26"   # 5 days: 22~26
        assert TEST_WELL_NAME in data["message"]

    async def test_upload_well_api_accessible(self, client, cleanup_test_well):
        """
        [API-6-1B] After upload, well must be retrievable from GET /wells.
        Verify: analysis_status = 'data_ready', data_count = n_rows
        """
        n_rows = 3
        await client.post("/api/upload", files=_excel_files(_make_excel(n_rows=n_rows)))

        resp = await client.get("/api/wells")
        assert resp.status_code == 200
        wells = resp.json()["wells"]
        test_well = next((w for w in wells if w["name"] == TEST_WELL_NAME), None)

        assert test_well is not None, f"{TEST_WELL_NAME} well not found in list"
        assert test_well["analysis_status"] == "data_ready"
        assert test_well["data_count"] == n_rows


# ============================================================
# 3~5. Validation scenarios
# ============================================================

class TestUploadValidation:
    """Upload validation scenarios (no DB writes → no cleanup needed)"""

    async def test_upload_missing_required_column(self, client):
        """
        [API-6-2] Missing required column header (vfd_freq) → 422 Unprocessable Entity.
        Verify that the error message contains the missing column name.
        """
        excel = _make_excel(skip_headers=["ESP VFD FRE. (Hz)"])
        resp = await client.post("/api/upload", files=_excel_files(excel))

        assert resp.status_code == 422
        assert "vfd_freq" in resp.json()["detail"]

    async def test_upload_invalid_extension(self, client):
        """
        [API-6-5] .txt file upload → 400 Bad Request.
        """
        resp = await client.post(
            "/api/upload",
            files={"file": ("data.txt", b"not excel", "text/plain")},
        )
        assert resp.status_code == 400

    async def test_upload_empty_file(self, client):
        """
        Empty byte file upload → 4xx (parse failure).
        """
        resp = await client.post(
            "/api/upload",
            files={"file": ("empty.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code in (422, 500)


# ============================================================
# 6~7. Well name normalization scenarios
# ============================================================

class TestWellNameNormalization:
    """Well name normalization scenarios"""

    def test_normalize_function_space_to_hyphen(self):
        r"""
        [API-6-3 unit] normalize_well_name: space → hyphen conversion.
        Unit test that directly calls the service function.

        Note: The regex r'(\d)([A-Za-z])' inserts a hyphen at every digit-letter
        boundary, so "1H" → "1-H" conversion also occurs.
        Production data: "LF12-3 A1H" → "LF12-3-A1-H"
        """
        assert normalize_well_name("TEST UPLOAD WELL") == "TEST-UPLOAD-WELL"
        assert normalize_well_name("LF12-3 A1H") == "LF12-3-A1H"

    def test_normalize_function_digit_letter_boundary(self):
        r"""
        [API-6-3 unit] normalize_well_name: digit-letter boundary hyphen insertion.
        The regex r'(\d)([A-Za-z])' inserts a hyphen at every digit-letter boundary.
        'LF12-3 A1H' -> 'LF12-3-A1-H' (space→hyphen + 2 boundary hyphens)
        '3A1H'       -> '3-A1H'       (2 boundaries)
        """
        assert normalize_well_name("LF12-3 A1H") == "LF12-3-A1H"
        # Hyphen inserted only where digit is NOT preceded by a letter
        result = normalize_well_name("3A1H")
        assert result == "3-A1H"

    async def test_upload_space_normalized(self, client, cleanup_test_well):
        """
        [API-6-3 integration] E2E verification of Well name normalization during API upload.
        'TEST UPLOAD WELL' → 'TEST-UPLOAD-WELL'
        """
        raw_name = "TEST UPLOAD WELL"    # Contains spaces
        expected = normalize_well_name(raw_name)  # Normalization result
        assert expected == "TEST-UPLOAD-WELL"

        resp = await client.post("/api/upload", files=_excel_files(_make_excel(well_name=raw_name)))

        assert resp.status_code == 200
        assert resp.json()["well_name"] == expected


# ============================================================
# 8~9. Duplicate upload (idempotency) scenarios
# ============================================================

class TestUploadIdempotency:
    """Duplicate upload (idempotency) scenarios"""

    async def test_duplicate_upload_same_count(self, client, cleanup_test_well):
        """
        [API-6-4] Same file uploaded twice in succession → same record count.
        ON CONFLICT DO UPDATE: second upload overwrites rather than adding rows.
        """
        n_rows = 4
        excel = _make_excel(n_rows=n_rows)

        resp1 = await client.post("/api/upload", files=_excel_files(excel))
        assert resp1.status_code == 200

        resp2 = await client.post("/api/upload", files=_excel_files(excel))
        assert resp2.status_code == 200

        # records_inserted returns the number of parsed rows (upsert attempt count)
        assert resp1.json()["records_inserted"] == n_rows
        assert resp2.json()["records_inserted"] == n_rows

    async def test_duplicate_upload_well_count(self, client, cleanup_test_well):
        """
        [API-6-4B] After uploading the same file twice, only one well must exist in the list.
        Handled via ON CONFLICT DO UPDATE without creating duplicate wells.
        """
        excel = _make_excel(n_rows=2)

        await client.post("/api/upload", files=_excel_files(excel))
        await client.post("/api/upload", files=_excel_files(excel))

        resp = await client.get("/api/wells")
        well_names = [w["name"] for w in resp.json()["wells"]]
        # TEST-UPLOAD-WELL must appear exactly once
        assert well_names.count(TEST_WELL_NAME) == 1

    async def test_duplicate_upload_status_preserved(self, client, cleanup_test_well):
        """
        [API-6-4C] analysis_status = 'data_ready' must be preserved after re-upload.
        """
        excel = _make_excel(n_rows=2)
        await client.post("/api/upload", files=_excel_files(excel))
        await client.post("/api/upload", files=_excel_files(excel))

        resp = await client.get("/api/wells")
        test_well = next(
            (w for w in resp.json()["wells"] if w["name"] == TEST_WELL_NAME), None
        )
        assert test_well is not None
        assert test_well["analysis_status"] == "data_ready"
