"""
Step 3 Service: 3-Pillar 독립 고장 모드 알람 모니터링

3개 고장 모드를 각각 독립적으로 평가:
  - Pillar 1 (Hydraulic):  ψ_ma30 slope Z-score 급감 + Mann-Kendall 중기 추세
  - Pillar 2 (Mechanical): v_std_ma30 slope Z-score 급증 + Mann-Kendall 중기 추세
  - Pillar 3 (Electrical): current_leak 이동 중앙값 절대값 + 3일 지속 조건

통합 점수 없음. 예지 날짜 없음. 각 Pillar를 독립 판정.

알람 등급 (Pillar 1/2):
  CRITICAL: 최근 30일 기울기가 전체 운전 이력 대비 Z ≤ -2.0(P1) / Z ≥ +2.0(P2)
            → "전체 이력에서 가장 가파른 ~2.3% 수준"의 이례적 변화
  WARNING:  Mann-Kendall p < 0.05 AND tau 방향 일치 (60일 중기 추세 유의)
  NORMAL:   그 외
  UNKNOWN:  slope 이력 < 60 포인트 (신규 Well) 또는 데이터 없음

설계 근거 (절대값 임계치 → slope Z-score 전환):
  run-in → 셧다운 → 재가동이 반복되는 ESP에서 "초기 안정 구간"을 절대값
  기준으로 고정하면 run-in 저점이 baseline이 되어 CRITICAL이 발동하지 않음.
  slope Z-score는 "전체 운전 이력 내 최근 기울기의 상대적 이상함"을 측정하므로
  Well별 운전 특성을 자동 반영하며, 절대 레벨 무관하게 이례적 추세를 탐지.
"""
from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import norm
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import (
    AnalysisSession,
    BaselinePeriod,
    PillarResult,
    ResidualData,
)
from app.models.esp_data import EspDailyData
from app.models.well import Well

# ============================================================
# 상수
# ============================================================

# Pillar 1/2: 기울기 계산 창 (일) — 최근 30일 추세를 단기 신호로 포착
SLOPE_WINDOW = 30

# Pillar 1/2: Z-score 계산용 최소 slope 이력 포인트 수
# (신규 Well은 이력 부족으로 UNKNOWN 반환)
SLOPE_HISTORY_MIN = 60

# Pillar 1: slope Z-score CRITICAL 임계치 (급감, 실데이터 검증: Z=-2.1이 실제 극점)
P1_CRITICAL_Z = -2.0

# Pillar 2: slope Z-score CRITICAL 임계치 (급증)
P2_CRITICAL_Z = +2.0

# Mann-Kendall 검정에 사용할 최근 N일 창 (중기 WARNING용)
MK_WINDOW = 60

# Pillar 3: 이동 중앙값 창 (스파이크 노이즈 제거)
LEAK_MEDIAN_DAYS = 7

# Pillar 3: 연속 초과 지속 일수 조건 (일시적 스파이크 방지)
PERSIST_DAYS = 3

# Pillar 3: WARNING / CRITICAL 임계치 (μA)
P3_WARN_UA = 100
P3_CRIT_UA = 1000

# Pillar 4: 모터 온도 WARNING / CRITICAL 임계치 (°C)
P4_WARN_TEMP = 130.0
P4_CRIT_TEMP = 150.0
TEMP_MEDIAN_DAYS = 7  # 스파이크 노이즈 제거용 이동 중앙값 창

# Mann-Kendall 유의수준
MK_ALPHA = 0.05

# P1/P2 Mann-Kendall 검정 최소 데이터 포인트
MK_MIN_POINTS = 7


# ============================================================
# 메인 분석 함수
# ============================================================

async def run_step3_analysis(
    well_id: str,
    db: AsyncSession,
) -> dict:
    """
    3-Pillar 독립 알람 분석 실행.

    Args:
      well_id: Well UUID 문자열
      db:      SQLAlchemy 비동기 세션

    Returns:
      {pillar1: {...}, pillar2: {...}, pillar3: {...}, computed_at: str}

    Raises:
      ValueError: baseline_periods 없음 (Step 2 미완료)
    """
    # ── 1. baseline_periods에서 training_end 조회 ─────────────
    training_end = await _get_training_end(well_id, db)
    if training_end is None:
        raise ValueError(
            "Step 2가 완료되지 않았습니다. baseline_periods에 학습 구간이 없습니다."
        )

    # ── 2. residual_data에서 psi_ma30, v_std_ma30 로드 ────────
    psi_df   = await _load_residual_col(well_id, "psi_ma30", db)
    vstd_df  = await _load_residual_col(well_id, "v_std_ma30", db)

    # ── 3. esp_daily_data에서 current_leak, motor_temp 로드 ───
    leak_df  = await _load_current_leak(well_id, db)
    temp_df  = await _load_motor_temp(well_id, db)

    # ── 4. 각 Pillar 계산 ─────────────────────────────────────
    # P1/P2는 각자의 변수 CV로 독립 baseline 탐지 (training_end 불필요)
    p1 = _compute_pillar1(psi_df)
    p2 = _compute_pillar2(vstd_df)
    p3 = _compute_pillar3(leak_df)
    p4 = _compute_pillar4(temp_df)

    # ── 5. pillar_results 저장 (Well당 최신 1건 유지) ──────────
    await db.execute(
        delete(PillarResult).where(PillarResult.well_id == uuid.UUID(well_id))
    )

    db.add(PillarResult(
        well_id         = uuid.UUID(well_id),
        # Pillar 1
        p1_status       = p1["status"],
        p1_tau          = p1["tau"],
        p1_pvalue       = p1["pvalue"],
        p1_current_val  = p1["current_val"],
        p1_baseline_val = p1["baseline_val"],
        p1_threshold    = p1["threshold"],
        # Pillar 2
        p2_status       = p2["status"],
        p2_tau          = p2["tau"],
        p2_pvalue       = p2["pvalue"],
        p2_current_val  = p2["current_val"],
        p2_baseline_val = p2["baseline_val"],
        p2_threshold    = p2["threshold"],
        # Pillar 3
        p3_status         = p3["status"],
        p3_current_val    = p3["current_val"],
        p3_days_exceeded  = p3["days_exceeded"],
        p3_data_available = p3["data_available"],
        # Pillar 4
        p4_status         = p4["status"],
        p4_current_val    = p4["current_val"],
        p4_data_available = p4["data_available"],
    ))

    # ── 6. analysis_sessions 파라미터 기록 ─────────────────────
    await _update_session_parameters(
        well_id=well_id,
        parameters={
            "p1_status": p1["status"],
            "p2_status": p2["status"],
            "p3_status": p3["status"],
            "p4_status": p4["status"],
        },
        db=db,
    )

    # ── 7. Well 상태 → fully_analyzed ──────────────────────────
    await _update_well_status(well_id, "fully_analyzed", db)

    await db.commit()

    return {
        "well_id":     well_id,
        "pillar1":     p1,
        "pillar2":     p2,
        "pillar3":     p3,
        "pillar4":     p4,
    }


# ============================================================
# 결과 조회 함수
# ============================================================

async def get_step3_result(well_id: str, db: AsyncSession) -> dict:
    """DB에 저장된 Step 3 결과(pillar_results) 조회."""
    result = await db.execute(
        select(PillarResult)
        .where(PillarResult.well_id == uuid.UUID(well_id))
        .order_by(PillarResult.computed_at.desc())
        .limit(1)
    )
    row = result.scalars().first()

    if row is None:
        raise ValueError("Step 3 결과 없음. Step 3 분석을 먼저 실행하세요.")

    return {
        "well_id":     well_id,
        "computed_at": str(row.computed_at) if row.computed_at else None,
        "pillar1": {
            "status":       row.p1_status,
            "tau":          row.p1_tau,
            "pvalue":       row.p1_pvalue,
            "current_val":  row.p1_current_val,
            "baseline_val": row.p1_baseline_val,
            "threshold":    row.p1_threshold,
        },
        "pillar2": {
            "status":       row.p2_status,
            "tau":          row.p2_tau,
            "pvalue":       row.p2_pvalue,
            "current_val":  row.p2_current_val,
            "baseline_val": row.p2_baseline_val,
            "threshold":    row.p2_threshold,
        },
        "pillar3": {
            "status":         row.p3_status,
            "current_val":    row.p3_current_val,
            "days_exceeded":  row.p3_days_exceeded,
            "data_available": row.p3_data_available if row.p3_data_available is not None else False,
        },
        "pillar4": {
            "status":         row.p4_status if hasattr(row, "p4_status") else "unknown",
            "current_val":    row.p4_current_val if hasattr(row, "p4_current_val") else None,
            "data_available": row.p4_data_available if hasattr(row, "p4_data_available") else False,
        },
    }


# ============================================================
# Pillar 계산 함수
# ============================================================

def _compute_slope_zscore(
    series: pd.Series,
    window: int = SLOPE_WINDOW,
    min_history: int = SLOPE_HISTORY_MIN,
) -> tuple[float, float]:
    """
    전체 운전 이력의 rolling slope 분포 기준으로 최근 slope Z-score를 반환.

    설계 근거:
      run-in → 셧다운 → 재가동이 반복되는 ESP에서 절대값 baseline 고정 방식은
      run-in 저점이 baseline이 되어 CRITICAL이 발동하지 않는 구조적 문제가 있음.
      slope Z-score는 "전체 운전 이력 대비 최근 기울기의 상대적 이상함"을
      측정하므로 절대 레벨 무관하게 이례적 추세를 탐지 가능.

    알고리즘:
      1. 각 포인트 i에서 [i-window+1, i] 구간 선형회귀 기울기 계산
      2. 전체 기울기 이력 (n ≥ min_history) → μ, σ 계산
      3. Z = (현재 기울기 - μ) / σ

    Returns:
      (slope_zscore, slope_mean)
        slope_zscore: Z값 (nan → 이력 부족 또는 계산 불가)
        slope_mean:   전체 이력 slope 평균 μ (baseline_val 필드에 저장)
    """
    slopes = []
    for i in range(len(series)):
        start = max(0, i - window + 1)
        segment = series.iloc[start : i + 1].dropna()
        # 최소 5포인트 미만이면 기울기 신뢰 불가 → skip
        if len(segment) < 5:
            slopes.append(np.nan)
            continue
        x = np.arange(len(segment))
        slope, _ = np.polyfit(x, segment.values, 1)
        slopes.append(slope)

    slope_series = pd.Series(slopes, index=series.index)
    hist = slope_series.dropna()

    # 이력 부족 (신규 Well) → UNKNOWN
    if len(hist) < min_history:
        return np.nan, np.nan

    mu = float(hist.mean())
    std = float(hist.std())

    current_slope_raw = slope_series.iloc[-1]
    if pd.isna(current_slope_raw):
        return np.nan, mu

    # std ≈ 0: 완전 단조 (기울기 변화 없음) → Z-score 의미 없음
    if std < 1e-12:
        return np.nan, mu

    return (float(current_slope_raw) - mu) / std, mu


def _compute_pillar1(psi_df: pd.DataFrame) -> dict:
    """
    Pillar 1: 유압 성능 알람 (Hydraulic Degradation)

    지표: ψ_ma30 (펌프 헤드 무차원화)
    알람:
      - CRITICAL: slope Z-score ≤ -2.0 (급감 — 전체 이력 대비 가장 가파른 ~2.3%)
      - WARNING:  Mann-Kendall p < 0.05 AND tau < 0 (60일 중기 하락 추세 유의)
      - NORMAL:   그 외
      - UNKNOWN:  slope 이력 < 60 포인트 또는 데이터 없음

    DB 필드 재활용 (스키마 변경 없음):
      tau          → slope Z-score (기존: Mann-Kendall τ)
      baseline_val → slope 이력 평균 μ (기존: anchor 평균)
      threshold    → Z-score 임계치 -2.0 (기존: 절대 임계치)
    """
    if psi_df.empty:
        return _unknown_pillar()

    psi_series = psi_df.set_index("date")["value"].dropna()
    if psi_series.empty:
        return _unknown_pillar()

    current_val = float(psi_series.iloc[-1])

    # slope Z-score: 전체 운전 이력 기준 최근 30일 기울기의 이상치 정도
    slope_z, slope_mu = _compute_slope_zscore(psi_series, SLOPE_WINDOW)

    # Mann-Kendall: 중기 60일 추세 (WARNING 판정용)
    mk_data = psi_df.dropna(subset=["value"]).tail(MK_WINDOW)["value"].values
    mk = _mann_kendall(mk_data) if len(mk_data) >= MK_MIN_POINTS else None

    # 알람 판정 (CRITICAL 우선)
    if not np.isnan(slope_z) and slope_z <= P1_CRITICAL_Z:
        status = "critical"
    elif mk and mk.pvalue < MK_ALPHA and mk.tau < 0:
        status = "warning"
    elif np.isnan(slope_z):
        # slope 이력 부족 → UNKNOWN (신규 Well)
        status = "unknown"
    else:
        status = "normal"

    return {
        "status":       status,
        # tau 필드에 slope Z-score 저장 (DB 스키마 변경 없음)
        "tau":          round(float(slope_z), 4) if not np.isnan(slope_z) else None,
        "pvalue":       round(float(mk.pvalue), 6) if mk else None,
        "current_val":  round(current_val, 6),
        # baseline_val 필드에 slope 이력 평균 μ 저장
        "baseline_val": round(float(slope_mu), 9) if not np.isnan(slope_mu) else None,
        # threshold 필드에 Z-score 임계치 저장 (고정값 -2.0)
        "threshold":    float(P1_CRITICAL_Z),
    }


def _compute_pillar2(vstd_df: pd.DataFrame) -> dict:
    """
    Pillar 2: 기계 진동 알람 (Mechanical Wear)

    지표: v_std_ma30 (진동 지수)
    알람:
      - CRITICAL: slope Z-score ≥ +2.0 (급증 — 전체 이력 대비 가장 가파른 ~2.3%)
      - WARNING:  Mann-Kendall p < 0.05 AND tau > 0 (60일 중기 상승 추세 유의)
      - NORMAL:   그 외
      - UNKNOWN:  slope 이력 < 60 포인트 또는 데이터 없음

    DB 필드 재활용 (스키마 변경 없음):
      tau          → slope Z-score (기존: Mann-Kendall τ)
      baseline_val → slope 이력 평균 μ (기존: anchor 평균)
      threshold    → Z-score 임계치 +2.0 (기존: 절대 임계치)
    """
    if vstd_df.empty:
        return _unknown_pillar()

    vstd_series = vstd_df.set_index("date")["value"].dropna()
    if vstd_series.empty:
        return _unknown_pillar()

    current_val = float(vstd_series.iloc[-1])

    # slope Z-score: 전체 운전 이력 기준 최근 30일 기울기의 이상치 정도
    slope_z, slope_mu = _compute_slope_zscore(vstd_series, SLOPE_WINDOW)

    # Mann-Kendall: 중기 60일 추세 (WARNING 판정용)
    mk_data = vstd_df.dropna(subset=["value"]).tail(MK_WINDOW)["value"].values
    mk = _mann_kendall(mk_data) if len(mk_data) >= MK_MIN_POINTS else None

    # 알람 판정 (CRITICAL 우선)
    if not np.isnan(slope_z) and slope_z >= P2_CRITICAL_Z:
        status = "critical"
    elif mk and mk.pvalue < MK_ALPHA and mk.tau > 0:
        status = "warning"
    elif np.isnan(slope_z):
        status = "unknown"
    else:
        status = "normal"

    return {
        "status":       status,
        "tau":          round(float(slope_z), 4) if not np.isnan(slope_z) else None,
        "pvalue":       round(float(mk.pvalue), 6) if mk else None,
        "current_val":  round(current_val, 6),
        "baseline_val": round(float(slope_mu), 9) if not np.isnan(slope_mu) else None,
        "threshold":    float(P2_CRITICAL_Z),
    }


def _compute_pillar4(temp_df: pd.DataFrame) -> dict:
    """
    Pillar 4: 모터 온도 알람 (Thermal)

    지표: motor_temp (°C)
    방식: 7일 이동 중앙값 (스파이크 노이즈 제거)
    알람:
      - CRITICAL: 7일 이동 중앙값 ≥ 150°C
      - WARNING:  7일 이동 중앙값 ≥ 130°C
      - NORMAL:   그 외
      - UNKNOWN:  motor_temp 전부 null
    """
    if temp_df.empty:
        return {"status": "unknown", "current_val": None, "data_available": False}

    non_null = temp_df.dropna(subset=["value"])
    if non_null.empty:
        return {"status": "unknown", "current_val": None, "data_available": False}

    # 7일 이동 중앙값으로 스파이크 노이즈 제거
    temp_df = temp_df.copy()
    temp_df["rolling_med"] = temp_df["value"].rolling(
        window=TEMP_MEDIAN_DAYS, min_periods=1
    ).median()

    latest = float(temp_df["rolling_med"].dropna().iloc[-1])

    if latest >= P4_CRIT_TEMP:
        status = "critical"
    elif latest >= P4_WARN_TEMP:
        status = "warning"
    else:
        status = "normal"

    return {
        "status":         status,
        "current_val":    round(latest, 2),
        "data_available": True,
    }


def _compute_pillar3(leak_df: pd.DataFrame) -> dict:
    """
    Pillar 3: 절연 누설 알람 (Electrical Leakage)

    지표: current_leak (μA 단위)
    방식: 이동 중앙값(7일) + 3일 연속 초과 조건
    알람:
      - CRITICAL: 최근 3일 연속 ≥ 1000μA
      - WARNING:  최근 3일 연속 ≥ 100μA
      - NORMAL:   그 외
      - UNKNOWN:  current_leak 전부 null
    """
    if leak_df.empty:
        return {"status": "unknown", "current_val": None, "days_exceeded": None, "data_available": False}

    # null 제거 후 데이터 있는지 확인
    non_null = leak_df.dropna(subset=["value"])
    if non_null.empty:
        return {"status": "unknown", "current_val": None, "days_exceeded": None, "data_available": False}

    # 이동 중앙값 계산 (스파이크 노이즈 제거)
    leak_df = leak_df.copy()
    leak_df["median_val"] = leak_df["value"].rolling(
        window=LEAK_MEDIAN_DAYS, min_periods=1
    ).median()

    # 최근 PERSIST_DAYS일 슬라이스
    recent = leak_df["median_val"].tail(PERSIST_DAYS)
    current_val = float(leak_df["median_val"].dropna().iloc[-1])

    # 3일 연속 초과 여부 판정
    if len(recent) >= PERSIST_DAYS and (recent >= P3_CRIT_UA).all():
        status       = "critical"
        days_exceeded = PERSIST_DAYS
    elif len(recent) >= PERSIST_DAYS and (recent >= P3_WARN_UA).all():
        status        = "warning"
        days_exceeded = PERSIST_DAYS
    else:
        status = "normal"
        # 실제 연속 초과 일수 계산 (역방향 카운트)
        days_exceeded = _count_consecutive_exceed(
            leak_df["median_val"].dropna().values, P3_WARN_UA
        )

    return {
        "status":         status,
        "current_val":    round(current_val, 4),
        "days_exceeded":  days_exceeded,
        "data_available": True,
    }


# ============================================================
# 내부 헬퍼: Mann-Kendall 검정 (수동 구현 — 외부 의존성 최소화)
# ============================================================

def _mann_kendall(x: np.ndarray) -> SimpleNamespace:
    """
    Mann-Kendall 단조 추세 검정 (수동 구현).

    S = Σ_{i<j} sign(x_j - x_i)
    τ = S / (n(n-1)/2)          (정규화된 추세 지표, -1~+1)
    z = S / sqrt(Var_S)
    p-value = 2 × (1 - Φ(|z|))  (양측 검정)

    Returns:
      SimpleNamespace(tau=float, pvalue=float)
    """
    n = len(x)
    if n < 2:
        return SimpleNamespace(tau=0.0, pvalue=1.0)

    # S 계산: 모든 쌍 (i, j), i < j
    s = 0
    for i in range(n - 1):
        for j in range(i + 1, n):
            diff = x[j] - x[i]
            if diff > 0:
                s += 1
            elif diff < 0:
                s -= 1
    # 단조 추세 지표 τ
    denominator = n * (n - 1) / 2
    tau = s / denominator if denominator > 0 else 0.0

    # 분산: Var(S) = n(n-1)(2n+5) / 18
    var_s = n * (n - 1) * (2 * n + 5) / 18.0
    if var_s <= 0:
        return SimpleNamespace(tau=tau, pvalue=1.0)

    z = s / np.sqrt(var_s)
    pvalue = float(2 * (1 - norm.cdf(abs(z))))

    return SimpleNamespace(tau=float(tau), pvalue=pvalue)


def _count_consecutive_exceed(values: np.ndarray, threshold: float) -> int:
    """최근 연속으로 threshold 이상인 일수를 역방향 카운트."""
    count = 0
    for v in reversed(values):
        if v >= threshold:
            count += 1
        else:
            break
    return count


def _unknown_pillar() -> dict:
    """데이터 부족 시 Pillar 1/2 공통 UNKNOWN 응답."""
    return {
        "status": "unknown", "tau": None, "pvalue": None,
        "current_val": None, "baseline_val": None, "threshold": None,
    }


# ============================================================
# 내부 헬퍼: 데이터 로드
# ============================================================

async def _load_residual_col(
    well_id: str,
    col_name: str,
    db: AsyncSession,
) -> pd.DataFrame:
    """
    residual_data에서 지정 컬럼 시계열 로드.
    결과: DataFrame columns = ['date', 'value']
    """
    col_attr = getattr(ResidualData, col_name)
    stmt = (
        select(ResidualData.date, col_attr)
        .where(ResidualData.well_id == uuid.UUID(well_id))
        .order_by(ResidualData.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    return df


async def _load_motor_temp(well_id: str, db: AsyncSession) -> pd.DataFrame:
    """
    esp_daily_data에서 motor_temp 시계열 로드.
    결과: DataFrame columns = ['date', 'value']
    """
    stmt = (
        select(EspDailyData.date, EspDailyData.motor_temp)
        .where(EspDailyData.well_id == uuid.UUID(well_id))
        .order_by(EspDailyData.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    return df


async def _load_current_leak(well_id: str, db: AsyncSession) -> pd.DataFrame:
    """
    esp_daily_data에서 current_leak 시계열 로드.
    결과: DataFrame columns = ['date', 'value']
    """
    stmt = (
        select(EspDailyData.date, EspDailyData.current_leak)
        .where(EspDailyData.well_id == uuid.UUID(well_id))
        .order_by(EspDailyData.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    return df


async def _get_training_end(well_id: str, db: AsyncSession) -> Optional[date]:
    """
    baseline_periods에서 training_end (= end_date) 조회.
    없으면 None 반환 (Step 2 미완료 신호).
    """
    result = await db.execute(
        select(BaselinePeriod.end_date)
        .where(BaselinePeriod.well_id == uuid.UUID(well_id))
        .order_by(BaselinePeriod.end_date.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row


# ============================================================
# 내부 헬퍼: DB 갱신
# ============================================================

async def _update_well_status(well_id: str, new_status: str, db: AsyncSession) -> None:
    """Well의 analysis_status 갱신."""
    result = await db.execute(select(Well).where(Well.id == uuid.UUID(well_id)))
    well = result.scalar_one_or_none()
    if well:
        well.analysis_status = new_status


async def _update_session_parameters(
    well_id: str,
    parameters: dict,
    db: AsyncSession,
) -> None:
    """Step 3 AnalysisSession 레코드에 파라미터 저장."""
    result = await db.execute(
        select(AnalysisSession).where(
            AnalysisSession.well_id     == uuid.UUID(well_id),
            AnalysisSession.step_number == 3,
        ).order_by(AnalysisSession.created_at.desc())
    )
    session = result.scalars().first()
    if session:
        session.parameters = parameters
