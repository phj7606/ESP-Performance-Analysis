"""
Excel file upload API.
File validation -> Excel parsing -> Well upsert -> esp_daily_data bulk upsert
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.column_config import MEASUREMENT_COLUMNS
from app.db.database import get_db
from app.models.esp_data import EspDailyData
from app.models.well import Well
from app.schemas.upload import UploadResponse
from app.services.upload_service import dataframe_to_records, parse_excel

router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload Excel file and load into DB.
    Idempotent: re-uploading the same Well on the same date overwrites existing data (ON CONFLICT DO UPDATE).
    """
    # 1. Validate file format
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files (.xlsx, .xls) are allowed.")

    # 2. Validate file size
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds limit (max {settings.MAX_UPLOAD_SIZE // 1024 // 1024}MB)",
        )

    # 3. Parse Excel
    try:
        well_name, df, warnings = parse_excel(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel parsing failed: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=422, detail="No valid data rows found.")

    async with db.begin():
        # 4. Well upsert: update if a Well with the same name exists, otherwise create
        well_stmt = (
            pg_insert(Well)
            .values(name=well_name, analysis_status="data_ready")
            .on_conflict_do_update(
                index_elements=["name"],
                set_={
                    "updated_at": func.now(),
                    "analysis_status": "data_ready",
                },
            )
            .returning(Well.id)
        )
        result = await db.execute(well_stmt)
        well_id = result.scalar_one()

        # 5. esp_daily_data bulk upsert
        # Process 464 rows with a single INSERT ... ON CONFLICT query (~10x faster than looping)
        records = dataframe_to_records(df, str(well_id))

        # Include only columns that exist in the DB (filter out unmapped columns)
        valid_cols = set(MEASUREMENT_COLUMNS + ["date", "well_id"])
        filtered_records = [
            {k: v for k, v in r.items() if k in valid_cols}
            for r in records
        ]

        esp_stmt = pg_insert(EspDailyData).values(filtered_records)
        # On conflict (same well_id + date), update measurement values
        update_set = {
            col: esp_stmt.excluded[col]
            for col in MEASUREMENT_COLUMNS
            if col in [c.key for c in EspDailyData.__table__.columns]
        }
        esp_stmt = esp_stmt.on_conflict_do_update(
            index_elements=["well_id", "date"],
            set_=update_set,
        )
        await db.execute(esp_stmt)

    # Calculate date range
    dates = [r["date"] for r in filtered_records if r.get("date")]
    date_range = (
        {"start": str(min(dates)), "end": str(max(dates))} if dates else None
    )

    return UploadResponse(
        well_id=well_id,
        well_name=well_name,
        records_inserted=len(df),
        date_range=date_range,
        columns_found=list(df.columns),
        warnings=warnings,
        message=f"Successfully loaded {len(df)} rows for Well '{well_name}'",
    )
