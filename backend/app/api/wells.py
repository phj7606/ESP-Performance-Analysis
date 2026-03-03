"""
Well 조회 API.
- 전체 목록 조회
- 상세 정보 조회
- 시계열 데이터 조회 (동적 컬럼 선택, 날짜 범위 필터)
"""
from datetime import date
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.esp_data import EspDailyData
from app.models.well import Well
from app.schemas.esp_data import EspDataPoint, EspDataResponse
from app.schemas.well import WellListResponse, WellResponse

router = APIRouter()

# 조회 가능한 컬럼 화이트리스트 (SQL injection 방지)
ALLOWED_COLUMNS = {
    "choke", "whp", "flt", "casing_pressure", "casing_pressure_2",
    "vfd_freq", "motor_volts", "motor_current", "motor_power",
    "motor_temp", "motor_vib", "current_leak",
    "pi", "ti", "pd", "static_pressure", "dd",
    "water_cut", "emulsion", "bsw",
    "mfm_pressure", "mfm_temp",
    "liquid_rate", "water_rate", "oil_haimo", "gas_meter", "gor",
    "dp_cross_pump", "liquid_pi", "oil_pi",
    "comment", "esp_type",
}


@router.get("/wells", response_model=WellListResponse)
async def list_wells(db: AsyncSession = Depends(get_db)):
    """
    전체 Well 목록 조회.
    각 Well의 데이터 건수 및 날짜 범위를 서브쿼리로 포함.
    """
    result = await db.execute(select(Well).order_by(Well.created_at.desc()))
    wells = result.scalars().all()

    well_responses = []
    for well in wells:
        # 데이터 건수 및 날짜 범위 조회
        stats = await db.execute(
            select(
                func.count(EspDailyData.date).label("cnt"),
                func.min(EspDailyData.date).label("min_date"),
                func.max(EspDailyData.date).label("max_date"),
            ).where(EspDailyData.well_id == well.id)
        )
        row = stats.fetchone()

        date_range = None
        if row and row.min_date:
            date_range = {"start": str(row.min_date), "end": str(row.max_date)}

        well_responses.append(
            WellResponse(
                id=well.id,
                name=well.name,
                field=well.field,
                latest_health_score=well.latest_health_score,
                analysis_status=well.analysis_status,
                data_count=row.cnt if row else 0,
                date_range=date_range,
                created_at=well.created_at,
                updated_at=well.updated_at,
            )
        )

    return WellListResponse(wells=well_responses, total=len(well_responses))


@router.get("/wells/{well_id}", response_model=WellResponse)
async def get_well(well_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Well 상세 정보 조회"""
    result = await db.execute(select(Well).where(Well.id == well_id))
    well = result.scalar_one_or_none()

    if not well:
        raise HTTPException(status_code=404, detail="Well을 찾을 수 없습니다.")

    # 데이터 통계
    stats = await db.execute(
        select(
            func.count(EspDailyData.date).label("cnt"),
            func.min(EspDailyData.date).label("min_date"),
            func.max(EspDailyData.date).label("max_date"),
        ).where(EspDailyData.well_id == well.id)
    )
    row = stats.fetchone()
    date_range = None
    if row and row.min_date:
        date_range = {"start": str(row.min_date), "end": str(row.max_date)}

    return WellResponse(
        id=well.id,
        name=well.name,
        field=well.field,
        latest_health_score=well.latest_health_score,
        analysis_status=well.analysis_status,
        data_count=row.cnt if row else 0,
        date_range=date_range,
        created_at=well.created_at,
        updated_at=well.updated_at,
    )


@router.get("/wells/{well_id}/data", response_model=EspDataResponse)
async def get_well_data(
    well_id: uuid.UUID,
    start_date: Optional[date] = Query(None, description="시작 날짜 (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="종료 날짜 (YYYY-MM-DD)"),
    columns: Optional[str] = Query(
        None, description="쉼표 구분 컬럼 목록 (미지정 시 전체)"
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Well 시계열 데이터 조회.
    - columns 파라미터로 필요한 컬럼만 요청 가능 (응답 경량화)
    - 최대 3000행 제한 (브라우저 렌더링 성능)
    """
    # Well 존재 확인
    well_result = await db.execute(select(Well.id).where(Well.id == well_id))
    if not well_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Well을 찾을 수 없습니다.")

    # 동적 컬럼 선택: 화이트리스트 기준으로 필터링 (SQL injection 방지)
    requested_cols = []
    if columns:
        requested_cols = [c.strip() for c in columns.split(",") if c.strip() in ALLOWED_COLUMNS]

    if requested_cols:
        # 날짜 + 요청 컬럼만 선택
        select_cols = [EspDailyData.date, EspDailyData.well_id] + [
            getattr(EspDailyData, col) for col in requested_cols
        ]
        query = select(*select_cols)
    else:
        # 전체 컬럼 선택
        query = select(EspDailyData)

    # 필터 조건 적용
    query = query.where(EspDailyData.well_id == well_id)
    if start_date:
        query = query.where(EspDailyData.date >= start_date)
    if end_date:
        query = query.where(EspDailyData.date <= end_date)

    # 날짜 오름차순 정렬, 최대 3000행
    query = query.order_by(EspDailyData.date.asc()).limit(3000)

    result = await db.execute(query)

    if requested_cols:
        # 매핑 방식으로 EspDataPoint 생성
        rows = result.fetchall()
        data_points = []
        for row in rows:
            row_dict = {"date": row.date}
            for col in requested_cols:
                row_dict[col] = getattr(row, col, None)
            data_points.append(EspDataPoint(**row_dict))
    else:
        rows = result.scalars().all()
        data_points = [EspDataPoint.model_validate(row) for row in rows]

    date_range = None
    if data_points:
        date_range = {
            "start": str(data_points[0].date),
            "end": str(data_points[-1].date),
        }

    return EspDataResponse(
        well_id=str(well_id),
        data=data_points,
        total=len(data_points),
        date_range=date_range,
    )
