"""
Excel file parsing service.
Extracts well names and cleans data according to the 'Production Data.xlsx' structure.
"""
import io
import re
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from app.core.column_config import (
    COLUMN_MAPPING,
    NULLABLE_COLUMNS,
    RECOMMENDED_COLUMNS,
    REQUIRED_COLUMNS,
)


def normalize_well_name(raw: str) -> str:
    """
    Normalize well name.
    Example: 'LF12-3 A1H' -> 'LF12-3-A1H'
    - Remove whitespace/tabs
    - Normalize consecutive hyphens
    - Insert hyphen at digit-letter boundary (e.g. '3A' -> '3-A')
    """
    name = str(raw).strip()
    # Replace whitespace with hyphens
    name = re.sub(r'\s+', '-', name)
    # Normalize consecutive hyphens
    name = re.sub(r'-+', '-', name)
    # Insert hyphen at digit-letter boundary only when digit is NOT preceded by a letter
    # e.g. '3A' -> '3-A' but 'A1H' stays 'A1H' (1 preceded by 'A')
    name = re.sub(r'(?<![A-Za-z])(\d)([A-Za-z])', r'\1-\2', name)
    return name


def _parse_single_sheet(raw_df: pd.DataFrame, sheet_label: str) -> tuple[str, pd.DataFrame, list[str]]:
    """
    단일 시트 DataFrame을 파싱하여 (well_name, cleaned_df, warnings) 반환.
    sheet_label은 경고 메시지에 시트 식별 용도로만 사용.
    """
    warnings: list[str] = []

    # A열(인덱스 0): Well 이름 추출 (첫 번째 non-null 값)
    well_name_raw = raw_df.iloc[:, 0].dropna().iloc[0]
    well_name = normalize_well_name(str(well_name_raw))

    # B열(인덱스 1): 날짜 파싱
    raw_df = raw_df.copy()
    raw_df['date'] = pd.to_datetime(raw_df.iloc[:, 1], errors='coerce').dt.date

    # 날짜 파싱 실패 행 제거
    invalid_dates = raw_df['date'].isna().sum()
    if invalid_dates > 0:
        warnings.append(f"[{sheet_label}] Skipped {invalid_dates} rows with invalid date")
    raw_df = raw_df.dropna(subset=['date'])

    # 컬럼 이름 → DB 컬럼명으로 매핑
    # 정규화 매칭: 헤더의 공백/대소문자 차이를 허용 (예: "Oil   PI" ↔ "oil pi")
    def _normalize(h: str) -> str:
        return re.sub(r'\s+', ' ', str(h).strip().lower())

    normalized_mapping = {_normalize(k): v for k, v in COLUMN_MAPPING.items()}

    # 매핑 전 원본 컬럼명 보존 → 매핑 누락 컬럼 추적용
    skip_cols = {'date', 'Well number (No.)'}
    rename_dict: dict[str, str] = {}
    unmapped_cols: list[str] = []
    for col in raw_df.columns:
        norm = _normalize(col)
        if norm in normalized_mapping:
            rename_dict[col] = normalized_mapping[norm]
        elif col not in skip_cols and not str(col).startswith('Unnamed'):
            unmapped_cols.append(col)

    raw_df = raw_df.rename(columns=rename_dict)

    # 매핑되지 않은 컬럼을 경고로 알림 (silent drop 방지)
    if unmapped_cols:
        warnings.append(
            f"[{sheet_label}] Unmapped columns (ignored): {unmapped_cols}"
        )

    # 필수 컬럼 존재 여부 검증
    missing = [c for c in REQUIRED_COLUMNS if c not in raw_df.columns]
    if missing:
        raise ValueError(f"[{sheet_label}] Missing required columns: {missing}")

    # 권장 컬럼 부재 경고 (ML 분석에 필요하지만 없어도 업로드는 허용)
    missing_recommended = [c for c in RECOMMENDED_COLUMNS if c not in raw_df.columns]
    if missing_recommended:
        warnings.append(
            f"[{sheet_label}] Recommended columns not found "
            f"(ML analysis may be limited): {missing_recommended}"
        )

    # VARCHAR 컬럼(comment, esp_type) 정리: pandas가 빈 셀을 float NaN으로 읽거나
    # 데이터 입력 오류로 숫자가 들어온 경우 → None 처리 (asyncpg VARCHAR 타입 충돌 방지)
    for col in ['comment', 'esp_type']:
        if col in raw_df.columns:
            raw_df[col] = raw_df[col].apply(
                lambda x: None if (x is None or (isinstance(x, float))) else str(x)
            )

    # Nullable 컬럼: 0이 아닌 None 유지 (생산량 컬럼은 null이 정상)
    for col in NULLABLE_COLUMNS:
        if col in raw_df.columns:
            raw_df[col] = raw_df[col].where(raw_df[col].notna(), other=None)

    # 숫자형 컬럼의 NaN → None (JSON/DB 호환)
    numeric_cols = raw_df.select_dtypes(include=[np.number]).columns
    raw_df[numeric_cols] = raw_df[numeric_cols].where(raw_df[numeric_cols].notna(), other=None)

    # 날짜 중복 제거 (마지막 값 유지)
    duplicates = raw_df.duplicated(subset='date').sum()
    if duplicates > 0:
        warnings.append(f"[{sheet_label}] Removed {duplicates} duplicate date rows (kept latest)")
    raw_df = raw_df.drop_duplicates(subset='date', keep='last')

    # 날짜 오름차순 정렬
    raw_df = raw_df.sort_values('date').reset_index(drop=True)

    # Unnamed 컬럼 및 원본 Well 이름 컬럼 제거
    cols_to_drop = [c for c in raw_df.columns if str(c).startswith('Unnamed')]
    if 'Well number (No.)' in raw_df.columns:
        cols_to_drop.append('Well number (No.)')
    raw_df = raw_df.drop(columns=cols_to_drop, errors='ignore')

    return well_name, raw_df, warnings


def parse_excel(file_bytes: bytes) -> list[tuple[str, pd.DataFrame, list[str]]]:
    """
    모든 시트를 읽어 (well_name, df, warnings) 튜플 리스트 반환.

    sheet_name=None → pandas가 {시트명: DataFrame} 딕셔너리로 반환.
    빈 시트는 스킵하며, 각 시트에 동일한 파싱 로직 적용.

    Returns:
        list of (well_name, cleaned_df, warnings) per sheet
    """
    # sheet_name=None: 모든 시트를 dict[str, DataFrame]으로 반환
    all_sheets: dict = pd.read_excel(io.BytesIO(file_bytes), sheet_name=None, header=0)

    results = []
    for sheet_name, raw_df in all_sheets.items():
        # 빈 시트 스킵
        if raw_df.empty:
            continue
        # A열에 유효한 데이터가 없으면 스킵 (헤더만 있는 시트)
        if raw_df.iloc[:, 0].dropna().empty:
            continue

        well_name, cleaned_df, warnings = _parse_single_sheet(raw_df, sheet_label=str(sheet_name))
        results.append((well_name, cleaned_df, warnings))

    return results


def dataframe_to_records(
    df: pd.DataFrame,
    well_id: str,
) -> list[dict]:
    """
    Convert a DataFrame to a list of dictionaries for DB upsert.
    None values are preserved as-is (stored as NULL in the DB).
    """
    records = []
    for _, row in df.iterrows():
        record: dict = {"well_id": well_id}
        for col in df.columns:
            val = row[col]
            # pandas NaN -> None (DB NULL)
            if val is None or (isinstance(val, float) and np.isnan(val)):
                record[col] = None
            elif isinstance(val, (np.integer,)):
                record[col] = int(val)
            elif isinstance(val, (np.floating,)):
                record[col] = float(val)
            elif isinstance(val, date):
                record[col] = val
            else:
                record[col] = val
        records.append(record)
    return records
