"""
Excel file upload API.
File validation -> Excel parsing -> Well upsert -> esp_daily_data bulk upsert
멀티 시트 지원: 모든 시트를 순회하여 각 Well을 개별 적재
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
from app.schemas.upload import UploadResponse, WellUploadResult
from app.services.upload_service import dataframe_to_records, parse_excel

router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Excel 파일을 업로드하여 DB에 적재.
    - 모든 시트를 순회하여 각 Well 데이터를 개별 처리
    - 멱등성 보장: 동일 Well + 날짜 재업로드 시 기존 데이터 덮어씀 (ON CONFLICT DO UPDATE)
    """
    # 1. 파일 포맷 검증
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files (.xlsx, .xls) are allowed.")

    # 2. 파일 크기 검증
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds limit (max {settings.MAX_UPLOAD_SIZE // 1024 // 1024}MB)",
        )

    # 3. 모든 시트 파싱 (sheet_name=None → 딕셔너리 반환)
    try:
        sheet_results = parse_excel(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel parsing failed: {str(e)}")

    if not sheet_results:
        raise HTTPException(status_code=422, detail="No valid sheets found in the uploaded file.")

    well_results: list[WellUploadResult] = []

    # 분석이 진행된 상태 목록 (data_ready 이후 → 재업로드 시 리셋 경고 대상)
    PROGRESSED_STATUSES = {"diagnosis_done", "health_done", "fully_analyzed"}

    async with db.begin():
        for sheet_idx, (well_name, df, warnings) in enumerate(sheet_results):
            if df.empty:
                continue

            # 4a. 기존 Well의 analysis_status 확인 → 분석 완료 상태에서 재업로드 시 경고
            existing = await db.execute(
                select(Well.analysis_status).where(Well.name == well_name)
            )
            existing_status = existing.scalar_one_or_none()
            if existing_status in PROGRESSED_STATUSES:
                # 기존 분석 결과는 DB에 남지만 status가 data_ready로 초기화됨을 알림
                warnings = list(warnings) + [
                    f"기존 분석 상태({existing_status})가 data_ready로 초기화됩니다. "
                    "새 데이터 업로드 후 분석을 다시 실행하세요."
                ]

            # 4b. Well upsert: 동일 이름의 Well이 있으면 갱신, 없으면 생성
            # sheet_order: 엑셀 시트 순서를 저장하여 Home 화면 정렬에 활용
            well_stmt = (
                pg_insert(Well)
                .values(name=well_name, analysis_status="data_ready", sheet_order=sheet_idx)
                .on_conflict_do_update(
                    index_elements=["name"],
                    set_={
                        "updated_at": func.now(),
                        "analysis_status": "data_ready",
                        "sheet_order": sheet_idx,
                    },
                )
                .returning(Well.id)
            )
            result = await db.execute(well_stmt)
            well_id = result.scalar_one()

            # 5. esp_daily_data bulk upsert
            # 단일 INSERT ... ON CONFLICT 쿼리로 처리 (행 루프보다 ~10배 빠름)
            records = dataframe_to_records(df, str(well_id))

            # DB에 존재하는 컬럼만 필터링 (매핑되지 않은 컬럼 제외)
            valid_cols = set(MEASUREMENT_COLUMNS + ["date", "well_id"])
            filtered_records = [
                {k: v for k, v in r.items() if k in valid_cols}
                for r in records
            ]

            esp_stmt = pg_insert(EspDailyData).values(filtered_records)
            # 충돌(동일 well_id + date) 시 측정값 갱신
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

            well_results.append(WellUploadResult(
                well_id=well_id,
                well_name=well_name,
                records_inserted=len(df),
                date_range=date_range,
                columns_found=list(df.columns),
                warnings=warnings,
            ))

    total_records = sum(r.records_inserted for r in well_results)
    total_wells = len(well_results)

    return UploadResponse(
        wells=well_results,
        total_wells=total_wells,
        total_records=total_records,
        message=f"Successfully loaded {total_records} rows for {total_wells} well(s)",
    )
