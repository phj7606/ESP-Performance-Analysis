"""
Excel 파일 업로드 API.
파일 검증 → Excel 파싱 → Well upsert → esp_daily_data bulk upsert
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
    Excel 파일 업로드 및 DB 적재.
    멱등성 보장: 동일 Well의 동일 날짜 재업로드 시 덮어쓰기 (ON CONFLICT DO UPDATE).
    """
    # 1. 파일 형식 검증
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Excel 파일(.xlsx, .xls)만 업로드 가능합니다.")

    # 2. 파일 크기 검증
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"파일 크기 초과 (최대 {settings.MAX_UPLOAD_SIZE // 1024 // 1024}MB)",
        )

    # 3. Excel 파싱
    try:
        well_name, df, warnings = parse_excel(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel 파싱 실패: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=422, detail="유효한 데이터 행이 없습니다.")

    async with db.begin():
        # 4. Well upsert: 동일 이름 Well이 있으면 업데이트, 없으면 생성
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
        # 한 번의 INSERT ... ON CONFLICT 쿼리로 464행 처리 (루프 대비 ~10배 빠름)
        records = dataframe_to_records(df, str(well_id))

        # DB에 존재하는 컬럼만 포함 (매핑되지 않은 컬럼 필터링)
        valid_cols = set(MEASUREMENT_COLUMNS + ["date", "well_id"])
        filtered_records = [
            {k: v for k, v in r.items() if k in valid_cols}
            for r in records
        ]

        esp_stmt = pg_insert(EspDailyData).values(filtered_records)
        # 충돌(동일 well_id + date) 시 측정값 업데이트
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

    # 날짜 범위 계산
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
        message=f"'{well_name}' Well 데이터 {len(df)}행 적재 완료",
    )
