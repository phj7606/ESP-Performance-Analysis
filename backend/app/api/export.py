"""
CSV Export API
Well 데이터를 esp_daily_data + residual_data + health_scores JOIN하여 단일 CSV로 내보냄.
분석 미완료 시에도 가용한 컬럼만 포함하여 부분 Export 허용.
"""

import io
import uuid
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, outerjoin
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.well import Well
from app.models.esp_data import EspDailyData
from app.models.analysis import ResidualData, HealthScore

router = APIRouter()


@router.get("/wells/{well_id}/export", tags=["export"])
async def export_well_csv(
    well_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Well 분석 데이터를 통합 CSV로 Export.
    - esp_daily_data: 원본 센서 데이터
    - residual_data: Step 1 무차원 성능 지수 (분석 완료 시)
    - health_scores: Step 2 GMM 건강 점수 (분석 완료 시)
    분석 미완료 컬럼은 NULL로 포함.
    """
    # Well 존재 여부 확인
    well_result = await db.execute(select(Well).where(Well.id == well_id))
    well: Optional[Well] = well_result.scalar_one_or_none()
    if not well:
        raise HTTPException(status_code=404, detail="Well을 찾을 수 없습니다.")

    # esp_daily_data 조회 (기준 테이블)
    esp_result = await db.execute(
        select(EspDailyData)
        .where(EspDailyData.well_id == well_id)
        .order_by(EspDailyData.date)
    )
    esp_rows = esp_result.scalars().all()

    if not esp_rows:
        raise HTTPException(status_code=404, detail="해당 Well의 데이터가 없습니다.")

    # residual_data 조회 (Step 1 결과, 없으면 빈 dict)
    residual_result = await db.execute(
        select(ResidualData)
        .where(ResidualData.well_id == well_id)
        .order_by(ResidualData.date)
    )
    residual_rows = residual_result.scalars().all()
    # date → row 매핑으로 O(1) 조회
    residual_map = {r.date: r for r in residual_rows}

    # health_scores 조회 (Step 2 결과, 없으면 빈 dict)
    health_result = await db.execute(
        select(HealthScore)
        .where(HealthScore.well_id == well_id)
        .order_by(HealthScore.date)
    )
    health_rows = health_result.scalars().all()
    health_map = {h.date: h for h in health_rows}

    # DataFrame 구성: esp_daily_data 기준으로 JOIN
    records = []
    for esp in esp_rows:
        rd = residual_map.get(esp.date)
        hs = health_map.get(esp.date)

        row = {
            # 식별자
            "well_name": well.name,
            "date": esp.date.isoformat(),

            # 원본 센서 데이터 (esp_daily_data)
            "choke": esp.choke,
            "whp": esp.whp,
            "flt": esp.flt,
            "casing_pressure": esp.casing_pressure,
            "casing_pressure_2": esp.casing_pressure_2,
            "vfd_freq": esp.vfd_freq,
            "motor_volts": esp.motor_volts,
            "motor_current": esp.motor_current,
            "motor_power": esp.motor_power,
            "motor_temp": esp.motor_temp,
            "motor_vib": esp.motor_vib,
            "current_leak": esp.current_leak,
            "pi": esp.pi,
            "ti": esp.ti,
            "pd": esp.pd,
            "static_pressure": esp.static_pressure,
            "dd": esp.dd,
            "water_cut": esp.water_cut,
            "emulsion": esp.emulsion,
            "bsw": esp.bsw,
            "mfm_pressure": esp.mfm_pressure,
            "mfm_temp": esp.mfm_temp,
            "liquid_rate": esp.liquid_rate,
            "water_rate": esp.water_rate,
            "oil_haimo": esp.oil_haimo,
            "gas_meter": esp.gas_meter,
            "gor": esp.gor,
            "dp_cross_pump": esp.dp_cross_pump,
            "liquid_pi": esp.liquid_pi,
            "oil_pi": esp.oil_pi,
            "comment": esp.comment,
            "esp_type": esp.esp_type,

            # Step 1 무차원 성능 지수 (residual_data) — 분석 전 NULL
            "cp": rd.cp if rd else None,
            "psi": rd.psi if rd else None,
            "v_std": rd.v_std if rd else None,
            "t_eff": rd.t_eff if rd else None,
            "eta_proxy": rd.eta_proxy if rd else None,
            "cp_ma30": rd.cp_ma30 if rd else None,
            "psi_ma30": rd.psi_ma30 if rd else None,
            "v_std_ma30": rd.v_std_ma30 if rd else None,
            "t_eff_ma30": rd.t_eff_ma30 if rd else None,
            "eta_proxy_ma30": rd.eta_proxy_ma30 if rd else None,

            # Step 2 GMM 건강 점수 (health_scores) — 분석 전 NULL
            "mahalanobis_distance": hs.mahalanobis_distance if hs else None,
            "health_score": hs.health_score if hs else None,
            "health_status": hs.health_status if hs else None,
        }
        records.append(row)

    # pandas로 CSV 생성 (StreamingResponse로 스트리밍 전송)
    df = pd.DataFrame(records)
    buffer = io.StringIO()
    df.to_csv(buffer, index=False, encoding="utf-8-sig")  # UTF-8 BOM: Excel 한글 호환
    buffer.seek(0)

    # 파일명: {well_name}_export.csv (공백/특수문자는 언더스코어로 치환)
    safe_name = well.name.replace(" ", "_").replace("/", "_")
    filename = f"{safe_name}_export.csv"

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "text/csv; charset=utf-8-sig",
        },
    )
