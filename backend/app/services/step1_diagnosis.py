"""
Step 1 Service: 4개 무차원 성능 지수 계산 (전체 기간)

물리 원리:
  ESP의 상사 법칙(Affinity Laws)에 따르면 정상 운전 중 아래 4개 지수는
  VFD 주파수 변화와 무관하게 일정해야 한다.
  따라서 지수의 추세 변화 자체가 성능 저하의 직접적 신호가 된다.

4개 무차원 성능 지수:
  Cp    = motor_power / (sg_liquid × vfd_freq³)         — 전력 지수 (기계·전기 효율)
  ψ_corrected = (ΔP - C×WHP) / (sg_liquid × vfd_freq²) — 헤드 지수 (WHP 보정, 수력 성능)
  V_std = motor_vib / vfd_freq²                          — 진동 지수 (축·베어링 건전성)
  T_eff = (motor_temp - ti) / motor_power                — 냉각 지수 (열 방출 능력)

WHP 보정:
  WHP(wellhead pressure)의 변화는 운영 조건 변화로 ψ에 직접 반영되어
  실제 펌프 성능 저하와 혼동을 줄 수 있다. 선형 회귀로 WHP 영향을 분리:
    회귀: y = ΔP/(sg×f²), x = WHP/(sg×f²) → C = slope
    ψ_corrected = (ΔP - C × WHP) / (sg × f²)

변경 이력:
  - 구 step2_ridge.py에서 승격 (Step 2 → Step 1)
  - 베이스라인 의존성 제거: 전체 기간을 한 번에 계산
  - residual 컬럼 제거: Step 3(Prophet)은 health_score를 직접 사용
  - 상태 → 'diagnosis_done'
  - WHP 보정 헤드 지수 도입: _compute_whp_regression() + C_whp 파라미터
"""
from __future__ import annotations

import uuid
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import AnalysisSession, BaselinePeriod, ResidualData
from app.models.esp_data import EspDailyData
from app.models.well import Well


# ============================================================
# SG 계산 함수
# ============================================================

def compute_sg_liquid(
    wc: pd.Series,
    sg_oil: float,
    sg_water: float,
) -> pd.Series:
    """
    혼합 유체 비중(SG_liquid) 계산.

    수식: SG_liquid = water_cut × sg_water + (1 - water_cut) × sg_oil
    water_cut이 NaN인 경우:
      forward fill → backward fill 순서로 보완 (오일 필드에서 water_cut은 천천히 변함).
      전체가 NaN이면 0.85로 대체 (일반적인 오일 필드 water_cut 약 0.75~0.85 가정).
    """
    wc = wc.ffill().bfill()
    if wc.isna().all():
        wc = wc.fillna(0.85)
    return wc * sg_water + (1 - wc) * sg_oil


# ============================================================
# 무차원 지수 계산 함수
# ============================================================

def _compute_whp_regression(df: pd.DataFrame, sg_liquid: pd.Series) -> dict:
    """
    WHP 영향을 회귀 분석으로 분리하여 ψ 보정 계수(C) 산출.

    회귀 모델:
      y = ΔP/(sg×f²),  x = WHP/(sg×f²)
      → slope C: WHP 변화 1단위가 ψ에 미치는 영향

    반환:
      C(기울기), intercept(절편), r2(결정계수), n_samples(유효 데이터 수)

    폴백:
      유효 데이터 < 10행이거나 whp 컬럼이 없으면 C=0.0 (보정 없음) 반환.
      → WHP 미측정 Well에서도 Step 1이 정상 실행되도록 방어.
    """
    # whp 컬럼이 DataFrame에 없으면 보정 불가
    if "whp" not in df.columns:
        return {"C": 0.0, "intercept": None, "r2": None, "n_samples": 0}

    freq = df["vfd_freq"].replace(0, np.nan)
    sg   = sg_liquid.replace(0, np.nan)
    denom = sg * freq ** 2

    # 무차원화: ΔP와 WHP를 동일한 (sg×f²) 분모로 나눔
    y = (df["pd"] - df["pi"]) / denom   # ΔP/(sg×f²) = 보정 전 ψ
    x = df["whp"] / denom               # WHP/(sg×f²)

    # object dtype(bsw=None 전파 등)으로 np.isfinite가 실패할 수 있으므로 float 변환 후 처리
    y_f = pd.to_numeric(y, errors="coerce")
    x_f = pd.to_numeric(x, errors="coerce")
    mask = y_f.notna() & x_f.notna() & np.isfinite(y_f) & np.isfinite(x_f)
    if mask.sum() < 10:
        return {"C": 0.0, "intercept": None, "r2": None, "n_samples": int(mask.sum())}

    slope, intercept, r_value, _, _ = stats.linregress(x_f[mask], y_f[mask])
    return {
        "C":          float(slope),
        "intercept":  float(intercept),
        "r2":         float(r_value ** 2),
        "n_samples":  int(mask.sum()),
    }


def compute_dimensionless_indices(
    df: pd.DataFrame,
    sg_liquid: pd.Series,
    C_whp: float = 0.0,
) -> pd.DataFrame:
    """
    4개 무차원 성능 지수 + η_proxy + pump_load_index 계산.

    Args:
      df:        EspDailyData 컬럼이 있는 DataFrame
                 (필요 컬럼: vfd_freq, pi, pd, motor_power, motor_temp, motor_vib, ti, liquid_rate, whp)
      sg_liquid: 날짜별 혼합 유체 비중 Series
      C_whp:     WHP 보정 계수 (기본 0.0 = 보정 없음).
                 _compute_whp_regression()에서 산출한 slope를 전달.

    Returns:
      cp, psi, v_std, t_eff, eta_proxy, pump_load_index 컬럼이 있는 DataFrame

    방어적 처리:
      vfd_freq == 0 → NaN (0 나눗셈 방지)
      motor_power == 0 → T_eff, eta_proxy NaN (0 나눗셈 방지)
      sg_liquid == 0 → NaN (물리적으로 불가능하지만 방어)
      liquid_rate == 0 or NaN → pump_load_index NaN (현장 테스트 시에만 측정 가능)
      whp NaN → 보정 0으로 처리 (운영 중단 등 예외 방어, ψ NaN 전파 방지)
    """
    freq  = df["vfd_freq"].replace(0, np.nan)
    power = df["motor_power"].replace(0, np.nan)
    sg    = sg_liquid.replace(0, np.nan)

    result = pd.DataFrame(index=df.index)

    # Cp = motor_power / (sg × f³): 전력 지수
    result["cp"]    = df["motor_power"] / (sg * freq ** 3)

    # WHP 보정: whp가 NaN인 날은 보정 0으로 처리 (NaN 전파 방지)
    whp_safe = df["whp"].fillna(0.0) if "whp" in df.columns else pd.Series(0.0, index=df.index)

    # ψ_corrected = (ΔP - C × WHP) / (sg × f²): WHP 영향을 회귀로 분리한 헤드 지수
    delta_p_corrected = df["pd"] - df["pi"] - C_whp * whp_safe
    result["psi"]   = delta_p_corrected / (sg * freq ** 2)

    # V_std = motor_vib / f²: 진동 지수
    result["v_std"] = df["motor_vib"] / (freq ** 2)

    # T_eff = (motor_temp - ti) / motor_power: 냉각 지수
    result["t_eff"] = (df["motor_temp"] - df["ti"]) / power

    # η_proxy = ψ_corrected / Cp: WHP 보정된 ψ 기반 효율 지표
    # = [(ΔP - C×WHP)/(sg×f²)] / [motor_power/(sg×f³)]
    # = (ΔP - C×WHP) × f / motor_power  [psi·Hz/kW]
    # sg가 분자·분모에서 소거되므로 유체 밀도 보정 불필요.
    result["eta_proxy"] = delta_p_corrected * freq / power

    # pump_load_index = power / (ΔP × liquid_rate): 유량 대비 전력 부하
    # liquid_rate가 없거나 0이면 물리적 의미 없음 → NaN 처리
    delta_p_raw = (df["pd"] - df["pi"]).replace(0, np.nan)
    if "liquid_rate" in df.columns:
        liquid_rate = df["liquid_rate"].replace(0, np.nan)  # 현장 테스트 시에만 측정
    else:
        liquid_rate = pd.Series(np.nan, index=df.index)    # 컬럼 미존재 시 NaN → pump_load_index = NaN
    result["pump_load_index"] = power / (delta_p_raw * liquid_rate)

    return result


# ============================================================
# 메인 분석 함수
# ============================================================

async def run_step1_analysis(
    well_id: str,
    sg_oil: float,
    sg_water: float,
    db: AsyncSession,
) -> dict:
    """
    전체 기간 무차원 성능 지수 계산 후 DB 저장.

    Step 1은 베이스라인 기간 없이 전체 데이터를 처리한다.
    베이스라인 통계는 Step 2(건강 점수)에서 CV 자동 탐지로 결정된다.

    Args:
      well_id:  Well UUID 문자열
      sg_oil:   원유 비중 (기본 0.85)
      sg_water: 해수/물 비중 (기본 1.03)
      db:       SQLAlchemy 비동기 세션

    Returns:
      {rows_written, sg_oil, sg_water, data_start, data_end}
    """
    # ── 1. ESP 일간 데이터 로드 ──────────────────────────────
    df = await _load_esp_dataframe(well_id, db)
    if df.empty:
        raise ValueError("No ESP data found. Please upload data first.")

    data_start = str(df.index.min().date())
    data_end   = str(df.index.max().date())

    # ── 2. SG_liquid 계산 ───────────────────────────────────
    # BSW는 0~100% 단위로 저장됨 → SG 계산용으로 0~1 범위로 정규화
    bsw_fraction = df["bsw"] / 100.0
    sg_liquid = compute_sg_liquid(bsw_fraction, sg_oil, sg_water)

    # ── 2.5. WHP 회귀 분석 — ψ 보정 계수(C) 산출 ────────────
    # 전체 데이터셋 기반 1회 계산. 유효 WHP 데이터 < 10행 시 C=0.0 폴백.
    whp_reg = _compute_whp_regression(df, sg_liquid)
    C_whp   = whp_reg["C"]

    # ── 3. 4개 무차원 지수 계산 (WHP 보정 포함) ──────────────
    indices = compute_dimensionless_indices(df, sg_liquid, C_whp=C_whp)

    # ── 4. 30일 이동 평균 계산 ──────────────────────────────
    # rolling window=30, min_periods=1: 초기 30일 미만 구간에서도 계산 가능
    for col in ["cp", "psi", "v_std", "t_eff", "eta_proxy", "pump_load_index"]:
        indices[f"{col}_ma30"] = (
            indices[col].rolling(window=30, min_periods=1).mean()
        )

    # ── 5. residual_data UPSERT ─────────────────────────────
    # 기존 기록 삭제 후 전체 재삽입: 재분석 시 sg 파라미터 변경 반영
    await db.execute(
        delete(ResidualData).where(ResidualData.well_id == uuid.UUID(well_id))
    )

    def _f(v) -> Optional[float]:
        """float 변환. NaN/inf → None."""
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            return None
        return float(v)

    rows_to_insert = []
    for idx_date, row in indices.iterrows():
        rows_to_insert.append(
            ResidualData(
                well_id        = uuid.UUID(well_id),
                date           = idx_date.date(),
                cp             = _f(row["cp"]),
                psi            = _f(row["psi"]),
                v_std          = _f(row["v_std"]),
                t_eff          = _f(row["t_eff"]),
                eta_proxy            = _f(row["eta_proxy"]),
                pump_load_index      = _f(row["pump_load_index"]),
                cp_ma30              = _f(row["cp_ma30"]),
                psi_ma30             = _f(row["psi_ma30"]),
                v_std_ma30           = _f(row["v_std_ma30"]),
                t_eff_ma30           = _f(row["t_eff_ma30"]),
                eta_proxy_ma30       = _f(row["eta_proxy_ma30"]),
                pump_load_index_ma30 = _f(row["pump_load_index_ma30"]),
                # Step 3은 health_score를 직접 사용하므로 residual 불필요
                residual         = None,
                residual_ma30    = None,
                predicted        = None,
                actual           = None,
                degradation_rate = None,
            )
        )

    db.add_all(rows_to_insert)

    # ── 6. analysis_sessions.parameters 갱신 ───────────────
    # WHP 회귀 결과를 JSONB에 포함 → 재분석 시 자동 갱신, 별도 DB 컬럼 불필요
    await _update_session_parameters(
        well_id=well_id,
        parameters={
            "sg_oil":              sg_oil,
            "sg_water":            sg_water,
            "data_start":          data_start,
            "data_end":            data_end,
            "rows_written":        len(rows_to_insert),
            "psi_whp_coeff":       whp_reg["C"],
            "psi_whp_intercept":   whp_reg["intercept"],
            "psi_whp_r2":          whp_reg["r2"],
            "psi_whp_n_samples":   whp_reg["n_samples"],
        },
        db=db,
    )

    # ── 7. Well 분석 상태 → diagnosis_done ──────────────────
    await _update_well_status(well_id, "diagnosis_done", db)

    await db.commit()

    return {
        "sg_oil":       sg_oil,
        "sg_water":     sg_water,
        "data_start":   data_start,
        "data_end":     data_end,
        "rows_written": len(rows_to_insert),
    }


# ============================================================
# 결과 조회 함수
# ============================================================

async def get_step1_result(well_id: str, db: AsyncSession) -> dict:
    """
    DB에 저장된 Step 1 결과를 조회하여 API 응답 형식으로 반환.

    모든 포인트를 is_training=False로 반환 (Step 1은 training 구간 개념 없음).
    baseline_periods는 Step 2 내부에서만 사용하며 Step 1 UI에는 표시하지 않음.
    """
    stmt = (
        select(ResidualData)
        .where(ResidualData.well_id == uuid.UUID(well_id))
        .order_by(ResidualData.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    if not rows:
        raise ValueError("No Step 1 diagnosis data found. Please run the analysis first.")

    session_params = await _load_session_parameters(well_id, db)

    indices_list = []
    for row in rows:
        # Step 1은 training 구간 표시 없음 — 항상 False
        is_training = False

        indices_list.append({
            "date":           str(row.date),
            "cp":             row.cp,
            "psi":            row.psi,
            "v_std":          row.v_std,
            "t_eff":          row.t_eff,
            "eta_proxy":           row.eta_proxy,
            "pump_load_index":     row.pump_load_index,
            "cp_ma30":             row.cp_ma30,
            "psi_ma30":            row.psi_ma30,
            "v_std_ma30":          row.v_std_ma30,
            "t_eff_ma30":          row.t_eff_ma30,
            "eta_proxy_ma30":      row.eta_proxy_ma30,
            "pump_load_index_ma30": row.pump_load_index_ma30,
            "is_training":         is_training,
        })

    return {
        "well_id":             well_id,
        "sg_oil":              session_params.get("sg_oil", 0.85),
        "sg_water":            session_params.get("sg_water", 1.03),
        "data_start":          session_params.get("data_start"),
        "data_end":            session_params.get("data_end"),
        # WHP 보정 회귀 결과 — 프론트엔드에서 주석으로 표시
        "psi_whp_coeff":       session_params.get("psi_whp_coeff"),
        "psi_whp_intercept":   session_params.get("psi_whp_intercept"),
        "psi_whp_r2":          session_params.get("psi_whp_r2"),
        "psi_whp_n_samples":   session_params.get("psi_whp_n_samples"),
        "indices":             indices_list,
    }


# ============================================================
# 내부 헬퍼 함수
# ============================================================

async def _load_esp_dataframe(well_id: str, db: AsyncSession) -> pd.DataFrame:
    """무차원 지수 계산에 필요한 컬럼을 선택하여 DatetimeIndex DataFrame으로 반환."""
    stmt = (
        select(
            EspDailyData.date,
            EspDailyData.vfd_freq,
            EspDailyData.pi,
            EspDailyData.pd,
            EspDailyData.motor_power,
            EspDailyData.motor_temp,
            EspDailyData.motor_vib,
            EspDailyData.ti,
            EspDailyData.bsw,          # Haimo test BS&W (%) — water_cut 대신 사용
            EspDailyData.liquid_rate,  # pump_load_index 계산용 (현장 테스트 시에만 측정)
            EspDailyData.whp,          # WHP 보정 헤드 지수 계산용
        )
        .where(EspDailyData.well_id == uuid.UUID(well_id))
        .order_by(EspDailyData.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(
        rows,
        columns=["date", "vfd_freq", "pi", "pd", "motor_power", "motor_temp", "motor_vib", "ti", "bsw", "liquid_rate", "whp"],
    )
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    return df


async def _load_baseline(
    well_id: str,
    db: AsyncSession,
) -> Optional[BaselinePeriod]:
    """Well의 학습 구간 레코드를 조회 (없으면 None)."""
    result = await db.execute(
        select(BaselinePeriod).where(BaselinePeriod.well_id == uuid.UUID(well_id))
    )
    return result.scalar_one_or_none()


async def _update_well_status(
    well_id: str,
    new_status: str,
    db: AsyncSession,
) -> None:
    """Well의 analysis_status 갱신."""
    result = await db.execute(
        select(Well).where(Well.id == uuid.UUID(well_id))
    )
    well = result.scalar_one_or_none()
    if well:
        well.analysis_status = new_status


async def _update_session_parameters(
    well_id: str,
    parameters: dict,
    db: AsyncSession,
) -> None:
    """Step 1 AnalysisSession 레코드에 파라미터 저장."""
    result = await db.execute(
        select(AnalysisSession).where(
            AnalysisSession.well_id     == uuid.UUID(well_id),
            AnalysisSession.step_number == 1,
        ).order_by(AnalysisSession.created_at.desc())
    )
    session = result.scalars().first()
    if session:
        session.parameters = parameters


async def _load_session_parameters(well_id: str, db: AsyncSession) -> dict:
    """가장 최근 Step 1 세션의 parameters JSONB를 반환."""
    result = await db.execute(
        select(AnalysisSession).where(
            AnalysisSession.well_id     == uuid.UUID(well_id),
            AnalysisSession.step_number == 1,
            AnalysisSession.status      == "completed",
        ).order_by(AnalysisSession.created_at.desc())
    )
    session = result.scalars().first()
    if session and session.parameters:
        return session.parameters
    return {}
