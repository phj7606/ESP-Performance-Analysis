"""
Step 3 Service: 3-Pillar 독립 고장 모드 알람 모니터링

3개 고장 모드를 각각 독립적으로 평가:
  - Pillar 1 (Hydraulic):  ψ_ma30 Mann-Kendall 하락 추세 + CRITICAL 임계치
  - Pillar 2 (Mechanical): v_std_ma30 Mann-Kendall 상승 추세 + CRITICAL 임계치
  - Pillar 3 (Electrical): current_leak 이동 중앙값 절대값 + 3일 지속 조건

통합 점수 없음. 예지 날짜 없음. 각 Pillar를 독립 판정.

알람 등급:
  CRITICAL: 현재 값이 임계치 초과/하회 (즉각 조치 필요)
  WARNING:  Mann-Kendall 검정 유의한 추세 감지 (p<0.05)
  NORMAL:   정상
  UNKNOWN:  데이터 부족 또는 없음
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

# Mann-Kendall 검정에 사용할 최근 N일 창
MK_WINDOW = 60

# Pillar 3: 이동 중앙값 창 (스파이크 노이즈 제거)
LEAK_MEDIAN_DAYS = 7

# Pillar 3: 연속 초과 지속 일수 조건 (일시적 스파이크 방지)
PERSIST_DAYS = 3

# Pillar 1: 베이스라인 대비 CRITICAL 임계 하락 비율 (20% 하락)
P1_DECLINE_RATIO = 0.20

# Pillar 2: 베이스라인 대비 CRITICAL 임계 상승 비율 (50% 상승)
P2_RISE_RATIO = 0.50

# Pillar 3: WARNING / CRITICAL 임계치 (μA)
P3_WARN_UA = 100
P3_CRIT_UA = 1000

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

    # ── 3. esp_daily_data에서 current_leak 로드 ────────────────
    leak_df  = await _load_current_leak(well_id, db)

    # ── 4. 각 Pillar 계산 ─────────────────────────────────────
    p1 = _compute_pillar1(psi_df, training_end)
    p2 = _compute_pillar2(vstd_df, training_end)
    p3 = _compute_pillar3(leak_df)

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
    ))

    # ── 6. analysis_sessions 파라미터 기록 ─────────────────────
    await _update_session_parameters(
        well_id=well_id,
        parameters={
            "p1_status": p1["status"],
            "p2_status": p2["status"],
            "p3_status": p3["status"],
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
    }


# ============================================================
# Pillar 계산 함수
# ============================================================

def _compute_pillar1(psi_df: pd.DataFrame, training_end: date) -> dict:
    """
    Pillar 1: 유압 성능 알람 (Hydraulic Degradation)

    지표: ψ_ma30 (펌프 헤드 무차원화)
    추세: Mann-Kendall 하락 검정 (최근 60일)
    알람:
      - CRITICAL: 현재값 < threshold (baseline × 0.80)
      - WARNING:  p < 0.05 AND tau < 0 (유의한 하락 추세)
      - NORMAL:   그 외

    베이스라인: training_end 이전 구간 전체 평균
    """
    if psi_df.empty:
        return _unknown_pillar()

    # 베이스라인 평균 계산 (training_end 이전)
    baseline_data = psi_df.loc[
        psi_df["date"] <= pd.Timestamp(training_end), "value"
    ].dropna()

    if baseline_data.empty:
        return _unknown_pillar()

    baseline_val = float(baseline_data.mean())
    threshold    = baseline_val * (1.0 - P1_DECLINE_RATIO)

    # 최근값
    recent = psi_df["value"].dropna()
    if recent.empty:
        return _unknown_pillar()
    current_val = float(recent.iloc[-1])

    # Mann-Kendall 검정 (최근 MK_WINDOW일)
    mk_data = psi_df.dropna(subset=["value"]).tail(MK_WINDOW)["value"].values
    if len(mk_data) < MK_MIN_POINTS:
        # 데이터 부족: CRITICAL 판정만 가능
        if current_val < threshold:
            status = "critical"
        else:
            status = "unknown"
        return {
            "status": status, "tau": None, "pvalue": None,
            "current_val": current_val, "baseline_val": baseline_val, "threshold": threshold,
        }

    mk = _mann_kendall(mk_data)

    # 알람 판정 (CRITICAL 우선)
    if current_val < threshold:
        status = "critical"
    elif mk.pvalue < MK_ALPHA and mk.tau < 0:
        status = "warning"
    else:
        status = "normal"

    return {
        "status":       status,
        "tau":          round(float(mk.tau), 6),
        "pvalue":       round(float(mk.pvalue), 6),
        "current_val":  round(current_val, 6),
        "baseline_val": round(baseline_val, 6),
        "threshold":    round(threshold, 6),
    }


def _compute_pillar2(vstd_df: pd.DataFrame, training_end: date) -> dict:
    """
    Pillar 2: 기계 진동 알람 (Mechanical Wear)

    지표: v_std_ma30 (진동 지수)
    추세: Mann-Kendall 상승 검정 (최근 60일)
    알람:
      - CRITICAL: 현재값 > threshold (baseline × 1.50)
      - WARNING:  p < 0.05 AND tau > 0 (유의한 상승 추세)
      - NORMAL:   그 외
    """
    if vstd_df.empty:
        return _unknown_pillar()

    # 베이스라인 평균 계산
    baseline_data = vstd_df.loc[
        vstd_df["date"] <= pd.Timestamp(training_end), "value"
    ].dropna()

    if baseline_data.empty:
        return _unknown_pillar()

    baseline_val = float(baseline_data.mean())
    threshold    = baseline_val * (1.0 + P2_RISE_RATIO)

    # 최근값
    recent = vstd_df["value"].dropna()
    if recent.empty:
        return _unknown_pillar()
    current_val = float(recent.iloc[-1])

    # Mann-Kendall 검정
    mk_data = vstd_df.dropna(subset=["value"]).tail(MK_WINDOW)["value"].values
    if len(mk_data) < MK_MIN_POINTS:
        if current_val > threshold:
            status = "critical"
        else:
            status = "unknown"
        return {
            "status": status, "tau": None, "pvalue": None,
            "current_val": current_val, "baseline_val": baseline_val, "threshold": threshold,
        }

    mk = _mann_kendall(mk_data)

    # 알람 판정 (CRITICAL 우선)
    if current_val > threshold:
        status = "critical"
    elif mk.pvalue < MK_ALPHA and mk.tau > 0:
        status = "warning"
    else:
        status = "normal"

    return {
        "status":       status,
        "tau":          round(float(mk.tau), 6),
        "pvalue":       round(float(mk.pvalue), 6),
        "current_val":  round(current_val, 6),
        "baseline_val": round(baseline_val, 6),
        "threshold":    round(threshold, 6),
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
