"""
Step 2 Service: 건강 점수 산출 (EWMA 전처리 + Rolling GMM + Piecewise Linear 정규화)

알고리즘 개요:
  1. Step 1 결과(residual_data)에서 3개 피처 로드: eta_proxy, v_std, t_eff
  2. EWMA 스무딩 (span=7): 원본 → EWMA → log 변환 순서 (Option A)
     - log 이후 EWMA는 기하평균이 되어 Jensen 부등식 편향 발생 → 반드시 이전에 수행
  3. log 변환으로 수치 안정성 확보
  4. Standard Scaling (학습 창 기준 fit → 현재 시점 transform)
  5. Rolling GMM (Expanding → Rolling 창):
     - 초기 30일 미만: NaN (학습 데이터 부족)
     - 초기 30~90일:  Expanding Window (가용 데이터 전부)
     - 이후 90일+:    Rolling Window (최근 90일)
  6. GMM Log-Likelihood Piecewise Linear 정규화:
     train_ll = gmm.score_samples(train_scaled)
     p50 이상 → 80~100점 (정상 안정 구간)
     p10~p50  → 40~80점  (저하 초기~중기)
     p10 미만 → 0~40점   (심각 저하, PRD Critical 40점 임계치와 정합)
  7. 점수 EWMA 후처리 (span=5): 1~2일 단기 노이즈 제거, 주간 트렌드 보존
  8. 피처 기여도 계산: 정상 컴포넌트 평균으로부터의 편차² 비율
     diff = current_scaled - μ_normal
     contrib_i = diff_i² / Σ(diff_j²)

건강 상태 임계치:
  Normal:    score >= 70
  Degrading: 40 <= score < 70
  Critical:  score < 40  (Step 3 RUL 임계치)
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import AnalysisSession, BaselinePeriod, HealthScore, ResidualData, TrendResidualScore
from app.models.well import Well


# ============================================================
# 상수: 항상 고정으로 사용되는 3개 피처
# ============================================================

FIXED_FEATURES = ["log_eta", "log_v_std", "log_t_eff"]


# ============================================================
# EWMA 전처리 함수
# ============================================================

def _apply_ewma(df: pd.DataFrame, span: int = 7) -> pd.DataFrame:
    """
    log 변환 이전에 원본 피처에 EWMA 스무딩 적용.

    적용 순서: 원본 → EWMA → log 변환 (Option A)
    log 이후 EWMA는 기하평균이 되어 Jensen 부등식 편향 발생하므로 반드시 이전에 수행.
    min_periods=1: 초기 구간도 가용 데이터로 계산 (NaN 최소화).
    adjust=False: 재귀적 표준 지수 가중 방식.
    """
    smoothed = df.copy()
    for col in ["eta_proxy", "v_std", "t_eff"]:
        if col in smoothed.columns:
            smoothed[col] = smoothed[col].ewm(span=span, min_periods=1, adjust=False).mean()
    return smoothed


# ============================================================
# Piecewise Linear 점수 변환 함수
# ============================================================

def _ll_to_score_piecewise(current_ll: float, train_ll: np.ndarray) -> float:
    """
    2구간 선형 매핑으로 Log-Likelihood → 건강 점수 산출.

    구간 설계 근거:
      - p50 이상: 80~100점 — 정상 운전 시 점수 안정화 (천장 효과)
      - p10~p50: 40~80점  — 저하 진행 구간 (선형, 조기 탐지)
      - p10 미만: 0~40점  — 심각 저하 (PRD Critical 임계 40점과 정합)

    PRD 임계치 40점 해석:
      LL이 p10 이탈 = 학습 구간 하위 10% 수준 → Critical 신호.
      기존 선형 방식(p5 기준 0점)보다 조기 탐지 가능.

    파라미터 튜닝 불필요: percentile 기반이므로 데이터에 자동 적응.
    단분산 엣지케이스는 max(denominator, 1e-8)로 안전하게 처리.
    """
    p_min = np.percentile(train_ll, 0.5)   # 극단값 하한 (분모 안전 앵커; 학습 30~60행 시 p1이 최솟값에 근접하는 현상 방지)
    p2    = np.percentile(train_ll, 2)
    p20   = np.percentile(train_ll, 20)
    p90   = np.percentile(train_ll, 90)

    if current_ll >= p20:
        # p20~p90 → 80~100점: 학습 데이터 80%가 이 구간 → Tight Distribution에서도 정상 운전 안정화
        t = (current_ll - p20) / max(p90 - p20, 1e-8)
        return float(np.clip(80.0 + 20.0 * t, 80.0, 100.0))
    elif current_ll >= p2:
        # p2~p20 → 40~80점: 저하 초기~중기 (18%p 구간, 기존 p10~p50보다 넓음)
        t = (current_ll - p2) / max(p20 - p2, 1e-8)
        return float(40.0 + 40.0 * t)
    else:
        # p2 미만 → 0~40점: 진짜 이상 이탈만 Critical (기존 p10 대비 임계치 엄격화)
        t = (current_ll - p_min) / max(p2 - p_min, 1e-8)
        return float(np.clip(40.0 * t, 0.0, 40.0))


# ============================================================
# Rolling GMM 핵심 함수
# ============================================================

def _run_rolling_gmm(
    log_df: pd.DataFrame,
    min_window: int = 30,
    max_window: int = 60,   # 90 → 60: 최근 데이터 집중 (sklearn GMM sample_weight 미지원 대안)
) -> pd.DataFrame:
    """
    Rolling GMM with Expanding → Rolling Window.

    매 날짜 T에서:
      학습 창: max(data_start, T-max_window) ~ T-1
      초기(T < min_window): NaN (학습 데이터 부족)
      초기(min_window ≤ T < max_window): Expanding Window (가용 데이터 전부 사용)
      이후(T ≥ max_window): Rolling Window (최근 max_window일만 사용)

    점수 산출 (Log-Likelihood percentile 정규화):
      train_ll  = gmm.score_samples(train_scaled)
      ll_p5, ll_p95 = percentile(train_ll, [5, 95])
      score = clip(100 × (current_ll - ll_p5) / (ll_p95 - ll_p5), 0, 100)

    기여도 산출:
      정상 컴포넌트 = 학습 데이터의 책임도(responsibility) 합산 최대 컴포넌트
      diff = current_scaled - μ_normal
      contrib_i = diff_i² / Σ(diff_j²)  (합 = 1.0)

    Returns:
      날짜 인덱스를 가진 DataFrame (health_score, contribution_eta, contribution_v_std, contribution_t_eff)
    """
    NAN_ROW = {
        "health_score":       float("nan"),
        "contribution_eta":   float("nan"),
        "contribution_v_std": float("nan"),
        "contribution_t_eff": float("nan"),
    }
    results: dict[pd.Timestamp, dict] = {}

    for i, T in enumerate(log_df.index):
        # 학습 구간: Expanding(초기) → Rolling(이후)
        # i가 현재 시점이므로 i-1까지를 학습에 사용 (미래 데이터 누출 방지)
        window_start_idx = max(0, i - max_window)
        train_df = log_df.iloc[window_start_idx:i][FIXED_FEATURES].dropna()

        if len(train_df) < min_window:
            # 학습 데이터 부족 → NaN
            results[T] = NAN_ROW.copy()
            continue

        current_row = log_df.loc[[T], FIXED_FEATURES].dropna(how="any")
        if current_row.empty:
            # 현재 시점 피처 값 없음
            results[T] = NAN_ROW.copy()
            continue

        # Standard Scaling: 학습 구간으로만 fit → 현재 시점에 transform
        # (미래 정보 누출 방지: 현재 시점 통계를 학습에 반영하지 않음)
        scaler = StandardScaler()
        train_scaled   = scaler.fit_transform(train_df.values)
        current_scaled = scaler.transform(current_row.values)

        # GMM 학습
        # n_init=5: rolling 반복 학습 비용 절감 (reg_covar+Scaling으로 초기화 민감성 완화됨)
        # reg_covar=0.05: StandardScaling 후 분산≈1.0 → σ_min≈√0.05≈0.224 최소 불확실성 보장
        #   ESP 센서 불확실성 ~30%를 log 스케일에서 흡수; 진짜 이상은 3σ+ 이탈로 탐지 유지
        # covariance_type='full': 기본값이지만 명시적으로 선언 (가독성)
        gmm = GaussianMixture(
            n_components=2,
            n_init=5,
            reg_covar=0.05,           # 0.01 → 0.05: ESP 센서 불확실성 반영
            covariance_type='full',
            random_state=42,
        )
        try:
            gmm.fit(train_scaled)
        except Exception:
            results[T] = NAN_ROW.copy()
            continue

        # Piecewise Linear 점수 산출
        # 기존 선형 p5~p95 매핑 대신 3구간 분리 → 정상 구간 80~100점 안정화
        train_ll   = gmm.score_samples(train_scaled)
        current_ll = float(gmm.score_samples(current_scaled)[0])
        score      = _ll_to_score_piecewise(current_ll, train_ll)

        # 기여도 계산: 정상 컴포넌트 평균으로부터의 표준화 편차² 비율
        # - 정상 컴포넌트: 학습 데이터의 책임도 합산 기준 (weights_ 직접 비교보다 견고)
        # - StandardScaler 후 분산≈1이므로 inv(Σ) 대각 근사 충분
        resp       = gmm.predict_proba(train_scaled)   # shape (N, 2)
        normal_idx = int(resp.sum(axis=0).argmax())    # 학습 데이터를 더 많이 담당하는 컴포넌트

        mu   = gmm.means_[normal_idx]                  # 정상 상태 중심, shape (3,)
        diff = current_scaled[0] - mu                  # (x - μ): 정상 상태와의 편차
        d_sq = diff ** 2                               # 각 축별 편차²

        if d_sq.sum() < 1e-12:
            # 정상에 매우 가까운 경우 → 균등 분배
            contribs = np.array([1 / 3, 1 / 3, 1 / 3])
        else:
            contribs = d_sq / d_sq.sum()               # 합 = 1.0 (비율)

        results[T] = {
            "health_score":       score,
            "contribution_eta":   float(contribs[0]),
            "contribution_v_std": float(contribs[1]),
            "contribution_t_eff": float(contribs[2]),
        }

    result_df = pd.DataFrame.from_dict(results, orient="index")

    # 점수 EWMA 후처리: 1~2일 단기 노이즈 제거 (실제 저하는 수주~수개월 스케일)
    # adjust=False: 재귀 지수 가중 (표준 EWMA 방식)
    # min_periods=1: NaN 구간 직후 첫 유효값부터 계산 시작
    valid_mask = result_df["health_score"].notna()
    if valid_mask.sum() > 0:
        smoothed = result_df["health_score"].ewm(
            span=5, min_periods=1, adjust=False
        ).mean()
        # NaN 행(min_window 미만 구간)은 NaN 유지
        result_df.loc[valid_mask, "health_score"] = smoothed[valid_mask]

    return result_df


# ============================================================
# 메인 분석 함수
# ============================================================

async def run_step2_analysis(
    well_id: str,
    db: AsyncSession,
) -> dict:
    """
    EWMA 전처리 + Rolling GMM Log-Likelihood 방식 건강 점수 계산.

    Args:
      well_id: Well UUID 문자열
      db:      SQLAlchemy 비동기 세션

    Returns:
      {training_start, training_end, features_used, rows_written, k_factor}
      k_factor는 LL 방식에서 미사용 → None
    """
    # ── 1. Step 1 진단 결과 로드 (eta_proxy, v_std, t_eff) ──
    df = await _load_diagnosis_dataframe(well_id, db)
    if df.empty:
        raise ValueError(
            "No diagnosis data found. Please complete Step 1 (Performance Diagnosis) first."
        )

    # ── 2. EWMA 스무딩 (log 변환 이전에 적용) ────────────────
    # log 이후 EWMA는 Jensen 부등식 편향 발생 → 원본 → EWMA → log 순서 강제
    smoothed_df = _apply_ewma(df, span=7)

    # ── 3. log 변환 (수치 안정성) ───────────────────────────
    # 0 또는 음수 값은 NaN으로 처리 후 log 적용
    log_df = _apply_log_transform(smoothed_df)

    # ── 4. Rolling GMM → 건강 점수 + 기여도 DataFrame ───────
    result_df = _run_rolling_gmm(log_df, min_window=30, max_window=60)

    # ── 5. training_start / training_end 계산 ────────────────
    # "현재 참조 기준 창"을 차트에 표시: 마지막 날짜 기준 T_max-60 ~ T_max
    T_max = log_df.index.max()
    T_min = log_df.index.min()
    training_end   = T_max
    training_start = max(T_min, T_max - pd.Timedelta(days=60))

    def _classify(score: float) -> str:
        """건강 점수 → 상태 문자열."""
        if score >= 70:
            return "Normal"
        elif score >= 40:
            return "Degrading"
        else:
            return "Critical"

    def _safe_float(val: float) -> Optional[float]:
        """NaN → None 변환 (DB 저장용)."""
        return None if (val is None or np.isnan(val)) else float(val)

    # ── 6. health_scores 테이블 UPSERT ──────────────────────
    await db.execute(
        delete(HealthScore).where(HealthScore.well_id == uuid.UUID(well_id))
    )

    rows_to_insert = []
    for date_ts, row in result_df.iterrows():
        score_val = row["health_score"]
        score  = float(score_val) if not np.isnan(score_val) else None
        status = _classify(score) if score is not None else None

        rows_to_insert.append(
            HealthScore(
                well_id              = uuid.UUID(well_id),
                date                 = date_ts.date(),
                mahalanobis_distance = None,   # LL 방식에서 미사용; DB 컬럼 유지
                health_score         = score,
                health_status        = status,
                contribution_eta     = _safe_float(row["contribution_eta"]),
                contribution_v_std   = _safe_float(row["contribution_v_std"]),
                contribution_t_eff   = _safe_float(row["contribution_t_eff"]),
            )
        )

    db.add_all(rows_to_insert)

    # ── 7. baseline_periods 저장 (Rolling 창 기준) ───────────
    await _upsert_baseline_period(
        well_id=well_id,
        start_date=str(training_start.date()),
        end_date=str(training_end.date()),
        features_used=FIXED_FEATURES,
        db=db,
    )

    # ── 9. analysis_sessions.parameters 갱신 ────────────────
    await _update_session_parameters(
        well_id=well_id,
        parameters={
            "training_start": str(training_start.date()),
            "training_end":   str(training_end.date()),
            "features_used":  FIXED_FEATURES,
            "k_factor":       None,   # LL 방식 전환으로 불필요
            "rows_written":   len(rows_to_insert),
        },
        db=db,
    )

    # ── 10. Well 분석 상태는 업데이트하지 않음 ───────────────
    # GMM은 보조 분석(Step 2-B)으로 전환됨 → 워크플로우 상태 미갱신
    # latest_health_score 업데이트도 Trend-Residual(기본 Step 2)이 담당

    await db.commit()

    return {
        "training_start": str(training_start.date()),
        "training_end":   str(training_end.date()),
        "features_used":  FIXED_FEATURES,
        "k_factor":       None,
        "rows_written":   len(rows_to_insert),
    }


# ============================================================
# 결과 조회 함수
# ============================================================

async def get_step2_result(well_id: str, db: AsyncSession) -> dict:
    """
    DB에 저장된 Step 2 결과(건강 점수 시계열 + 기여도 + 참조 창 구간)를 조회하여 반환.
    """
    baseline = await _load_baseline(well_id, db)
    if baseline is None:
        raise ValueError("No health scoring result found. Please run Step 2 first.")

    stmt = (
        select(HealthScore)
        .where(HealthScore.well_id == uuid.UUID(well_id))
        .order_by(HealthScore.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    if not rows:
        raise ValueError("No health score data found. Please run Step 2 first.")

    session_params = await _load_session_parameters(well_id, db)

    scores_list = []
    for row in rows:
        # is_training: 최근 90일 참조 창 안에 포함되는지 표시
        is_training = False
        if baseline.start_date and baseline.end_date:
            is_training = baseline.start_date <= row.date <= baseline.end_date

        scores_list.append({
            "date":                 str(row.date),
            "mahalanobis_distance": row.mahalanobis_distance,  # 항상 None
            "health_score":         row.health_score,
            "health_status":        row.health_status,
            "is_training":          is_training,
            "contribution_eta":     row.contribution_eta,
            "contribution_v_std":   row.contribution_v_std,
            "contribution_t_eff":   row.contribution_t_eff,
        })

    return {
        "well_id":        well_id,
        "training_start": str(baseline.start_date) if baseline.start_date else None,
        "training_end":   str(baseline.end_date)   if baseline.end_date   else None,
        "features_used":  session_params.get("features_used", FIXED_FEATURES),
        "k_factor":       session_params.get("k_factor"),   # None
        "scores":         scores_list,
    }


# ============================================================
# Trend-Residual Health Scoring 파라미터 (2차 검토 확정값)
# ============================================================

# 이동평균 및 σ 창 크기
_TR_MA_WINDOW         = 30   # MA30 기준선 창
_TR_SIGMA_WINDOW      = 90   # 잔차 σ 계산 창 (90일 rolling, 초기는 expanding)
_TR_SIGMA_MIN_PERIODS = 10   # MA30 / σ 최소 데이터 수 (미만 → NaN)

# 이탈 감점: P_RES_MAX=40 → 스파이크 단독으로는 Critical(40점) 미진입
P_RES_MAX   = 40
# 기울기 감점: P_SLOPE_MAX=60 → 점진적 저하가 핵심 탐지 대상, Prophet 단조성 향상
P_SLOPE_MAX = 60
# 점수 하한: Prophet 외삽 시 0점 수렴으로 인한 changepoint 역추정 오류 방지
SCORE_FLOOR = 10

# 피처별 차등 계수 (방향: +1=감소 악화, -1=증가 악화)
_TR_FEATURE_PARAMS: dict[str, dict] = {
    "eta_proxy": {
        "weight":      0.50,   # 효율 종합지표 (가장 포괄적)
        "z_coeff":     8,      # 현행 유지
        "slope_coeff": 20,
        "direction":   +1,     # 감소 = 악화
    },
    "v_std": {
        "weight":      0.30,   # 베어링/기계 선행 지표
        "z_coeff":     12,     # 8→12: 진동 급등 즉각 반응 (베어링 손상 선행 신호)
        "slope_coeff": 20,
        "direction":   -1,     # 증가 = 악화
    },
    "t_eff": {
        "weight":      0.20,   # 열효율 후행 지표
        "z_coeff":     6,      # 8→6: 온도 스파이크 노이즈 완화
        "slope_coeff": 25,     # 20→25: 온도 장기 트렌드 강조
        "direction":   -1,     # 증가 = 악화
    },
}


# ============================================================
# Trend-Residual 핵심 함수: 단일 피처 점수 계산
# ============================================================

def _compute_trend_residual_score(
    series: pd.Series,
    feature_name: str,
) -> pd.Series:
    """
    단일 피처에 대한 Trend-Residual 건강 점수 계산.

    산출 절차:
    1. MA30 기준선: 30일 이동평균 (min_periods=10 미만 → NaN)
    2. σ: expanding(초기) → rolling 90일 전환, 하한=전형값의 2%
    3. P_res = clip(|residual/σ| × z_coeff, 0, P_RES_MAX=40)
       → 스파이크 단독 max 40점 감점 → 점수 60점 (Critical 미달)
    4. P_slope = clip(slope_norm × slope_coeff, 0, P_SLOPE_MAX=60)
       → 장기 하락 max 60점 감점 → 점수 40점 (Critical 경계 진입)
    5. score = clip(100 - P_res - P_slope, SCORE_FLOOR=10, 100)

    Args:
        series: EWMA 스무딩된 단일 피처 시계열 (날짜 인덱스)
        feature_name: "eta_proxy" | "v_std" | "t_eff"
    """
    params = _TR_FEATURE_PARAMS[feature_name]

    # MA30 기준선: min_periods=10 미만 → NaN (초기 구간 안정화)
    ma30 = series.rolling(window=_TR_MA_WINDOW, min_periods=_TR_SIGMA_MIN_PERIODS).mean()

    # 잔차 = 원본 - MA30 기준선
    residual = series - ma30

    # σ: expanding(초기) → rolling 90일 전환
    sigma_exp = residual.expanding(min_periods=_TR_SIGMA_MIN_PERIODS).std(ddof=1)
    sigma_rol = residual.rolling(_TR_SIGMA_WINDOW, min_periods=_TR_SIGMA_MIN_PERIODS).std(ddof=1)
    # rolling이 NaN인 구간(초기 90일 미만)은 expanding으로 대체
    sigma_raw = sigma_rol.where(sigma_rol.notna(), sigma_exp)

    # σ 하한: 전형값의 2% → 극안정 구간에서 Z 폭발 방지
    sigma_floor = series.expanding().median().abs() * 0.02
    sigma = sigma_raw.clip(lower=sigma_floor.clip(lower=1e-8))

    # P_res: 이탈 감점 (스파이크 단독으로는 40점 한계)
    z_score = residual.abs() / sigma
    p_res   = (z_score * params["z_coeff"]).clip(upper=P_RES_MAX).fillna(0)

    # P_slope: 정규화된 기울기 감점 (점진적 저하 탐지 핵심)
    ma30_diff      = ma30.diff()
    # 기울기 기준선: MA30 변화량의 90일 rolling std (안정 구간 변동폭 기준)
    slope_baseline = ma30_diff.rolling(_TR_SIGMA_WINDOW, min_periods=30).std(ddof=1).clip(lower=1e-8)
    # 최근 30일 MA30의 선형 기울기 (polyfit 1차 계수)
    slope_30 = ma30.rolling(_TR_MA_WINDOW, min_periods=_TR_SIGMA_MIN_PERIODS).apply(
        lambda y: np.polyfit(np.arange(len(y)), y, 1)[0], raw=True
    )
    # direction=+1: 감소가 나쁨(eta_proxy), direction=-1: 증가가 나쁨(v_std, t_eff)
    degrading_slope = params["direction"] * slope_30
    # fillna(0): 워밍업 구간(초기 30일 미만)에서 slope_norm이 NaN일 때
    # 0으로 대체하여 P_slope 감점 없음 처리 — 스펙 의사코드 미기재이나 의도적 구현
    # (slope_baseline도 초기 구간에서 NaN 가능 → 0 처리로 false alarm 방지)
    slope_norm      = (degrading_slope / slope_baseline).fillna(0)
    p_slope = slope_norm.clip(lower=0).mul(params["slope_coeff"]).clip(upper=P_SLOPE_MAX)

    return (100 - p_res - p_slope).clip(SCORE_FLOOR, 100)


# ============================================================
# Trend-Residual 메인 분석 함수
# ============================================================

async def run_step2b_analysis(well_id: str, db: AsyncSession) -> dict:
    """
    Trend-Residual Health Scoring (Step 2-B).

    Step 2-A(GMM)와 독립 실행. health_done 상태 이후에만 실행 가능.
    Step 1 residual_data(eta_proxy, v_std, t_eff)를 기반으로 MA30 추세-잔차 분리 방식으로 건강 점수 산출.

    감점 구조 설계 의도:
      스파이크 단독: max P_RES_MAX(40)점 감점 → 점수 60점 (Warning, Critical 미달)
      장기 하락 단독: max P_SLOPE_MAX(60)점 감점 → 점수 40점 (Critical 경계 진입)
      두 가지 동시: 최악 0점 → clip(SCORE_FLOOR=10, 100) 적용

    Returns:
        {"rows_written": int}
    """
    # ── 1. Step 1 진단 결과 로드 ──────────────────────────────
    df = await _load_diagnosis_dataframe(well_id, db)
    if df.empty:
        raise ValueError(
            "No diagnosis data found. Please complete Step 1 (Performance Diagnosis) first."
        )

    # ── 2. EWMA 스무딩 (기존 _apply_ewma 재활용) ──────────────
    smoothed = _apply_ewma(df, span=7)

    # ── 3. 피처별 개별 점수 계산 ──────────────────────────────
    score_eta = _compute_trend_residual_score(smoothed["eta_proxy"], "eta_proxy")
    score_v   = _compute_trend_residual_score(smoothed["v_std"],     "v_std")
    score_t   = _compute_trend_residual_score(smoothed["t_eff"],     "t_eff")

    # ── 4. 가중 평균 결합 ──────────────────────────────────────
    weighted = (
        _TR_FEATURE_PARAMS["eta_proxy"]["weight"] * score_eta +
        _TR_FEATURE_PARAMS["v_std"]["weight"]     * score_v   +
        _TR_FEATURE_PARAMS["t_eff"]["weight"]     * score_t
    )
    # 최솟값 보정: 최악 피처 점수 + 10점을 상한으로 설정
    # (가중 평균이 최솟값보다 10점 이상 높으면 → 최솟값 + 10으로 하한 조정)
    score_min   = pd.concat([score_eta, score_v, score_t], axis=1).min(axis=1)
    score_final = weighted.where(weighted <= score_min + 10, score_min + 10)

    # ── 5. trend_residual_scores 테이블 UPSERT ──────────────
    await db.execute(
        delete(TrendResidualScore).where(
            TrendResidualScore.well_id == uuid.UUID(well_id)
        )
    )

    def _classify(score: float) -> str:
        if score >= 70:   return "Normal"
        elif score >= 40: return "Degrading"
        else:             return "Critical"

    def _safe_float(val: "Any") -> Optional[float]:
        return None if (val is None or (isinstance(val, float) and np.isnan(val))) else float(val)

    rows_to_insert = []
    for date_ts in score_final.index:
        s = _safe_float(score_final.loc[date_ts])
        rows_to_insert.append(
            TrendResidualScore(
                well_id       = uuid.UUID(well_id),
                date          = date_ts.date(),
                health_score  = s,
                health_status = _classify(s) if s is not None else None,
                score_eta     = _safe_float(score_eta.loc[date_ts]),
                score_v_std   = _safe_float(score_v.loc[date_ts]),
                score_t_eff   = _safe_float(score_t.loc[date_ts]),
            )
        )

    db.add_all(rows_to_insert)

    # ── 6. Well latest_health_score 업데이트 (기본 Step 2로 전환됨) ──────
    # Trend-Residual이 기본 건강 점수 소스 → 대시보드 표시용 최신 점수 반영
    valid_rows = [r for r in rows_to_insert if r.health_score is not None]
    if valid_rows:
        well_result = await db.execute(select(Well).where(Well.id == uuid.UUID(well_id)))
        well = well_result.scalar_one_or_none()
        if well:
            well.latest_health_score = valid_rows[-1].health_score

    # ── 7. Well 분석 상태 → health_done (기본 Step 2로 전환됨) ──────────
    # Trend-Residual이 health_done을 설정 → Step 3(RUL 예측) 실행 가능
    await _update_well_status(well_id, "health_done", db)

    await db.commit()

    valid_count = sum(1 for r in rows_to_insert if r.health_score is not None)
    return {"rows_written": valid_count}


async def get_step2b_result(well_id: str, db: AsyncSession) -> dict:
    """DB에 저장된 Trend-Residual 건강 점수 시계열을 조회하여 반환."""
    stmt = (
        select(TrendResidualScore)
        .where(TrendResidualScore.well_id == uuid.UUID(well_id))
        .order_by(TrendResidualScore.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    if not rows:
        raise ValueError("No trend-residual scores found. Please run Step 2-B first.")

    scores_list = [
        {
            "date":          str(row.date),
            "health_score":  row.health_score,
            "health_status": row.health_status,
            "score_eta":     row.score_eta,
            "score_v_std":   row.score_v_std,
            "score_t_eff":   row.score_t_eff,
        }
        for row in rows
    ]
    return {"well_id": well_id, "scores": scores_list}


# ============================================================
# 내부 헬퍼 함수
# ============================================================

def _apply_log_transform(df: pd.DataFrame) -> pd.DataFrame:
    """
    3개 피처(eta_proxy, v_std, t_eff)에 log 변환 적용.

    0 이하 값은 NaN으로 처리 후 log 적용 (물리적으로 양수여야 하는 지수들).
    """
    log_df = pd.DataFrame(index=df.index)

    for src_col, dst_col in [
        ("eta_proxy", "log_eta"),
        ("v_std",     "log_v_std"),
        ("t_eff",     "log_t_eff"),
    ]:
        if src_col in df.columns:
            # 0 또는 음수 값 마스킹 → log 변환 불가
            vals = df[src_col].copy()
            vals[vals <= 0] = np.nan
            log_df[dst_col] = np.log(vals)

    return log_df


async def _load_diagnosis_dataframe(well_id: str, db: AsyncSession) -> pd.DataFrame:
    """residual_data 테이블에서 3개 피처(eta_proxy, v_std, t_eff)를 로드하여 DataFrame으로 반환."""
    stmt = (
        select(
            ResidualData.date,
            ResidualData.eta_proxy,
            ResidualData.v_std,
            ResidualData.t_eff,
        )
        .where(ResidualData.well_id == uuid.UUID(well_id))
        .order_by(ResidualData.date.asc())
    )
    result = await db.execute(stmt)
    rows = result.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["date", "eta_proxy", "v_std", "t_eff"])
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    return df


async def _load_baseline(
    well_id: str,
    db: AsyncSession,
) -> Optional[BaselinePeriod]:
    """Well의 참조 창 레코드를 조회."""
    result = await db.execute(
        select(BaselinePeriod).where(BaselinePeriod.well_id == uuid.UUID(well_id))
    )
    return result.scalar_one_or_none()


async def _upsert_baseline_period(
    well_id: str,
    start_date: str,
    end_date: str,
    features_used: list[str],
    db: AsyncSession,
) -> None:
    """baseline_periods 테이블에 참조 창 정보를 저장 (Well당 1개 레코드 유지)."""
    from datetime import date

    await db.execute(
        delete(BaselinePeriod).where(
            BaselinePeriod.well_id == uuid.UUID(well_id)
        )
    )

    new_record = BaselinePeriod(
        well_id         = uuid.UUID(well_id),
        start_date      = date.fromisoformat(start_date),
        end_date        = date.fromisoformat(end_date),
        training_start  = date.fromisoformat(start_date),   # 호환성 유지
        changepoints    = {"features_used": features_used},
        is_manually_set = False,
    )
    db.add(new_record)


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
    """Step 2 AnalysisSession 레코드에 모델 파라미터 저장."""
    result = await db.execute(
        select(AnalysisSession).where(
            AnalysisSession.well_id     == uuid.UUID(well_id),
            AnalysisSession.step_number == 2,
        ).order_by(AnalysisSession.created_at.desc())
    )
    session = result.scalars().first()
    if session:
        session.parameters = parameters


async def _load_session_parameters(well_id: str, db: AsyncSession) -> dict:
    """가장 최근 Step 2 세션의 parameters JSONB를 반환."""
    result = await db.execute(
        select(AnalysisSession).where(
            AnalysisSession.well_id     == uuid.UUID(well_id),
            AnalysisSession.step_number == 2,
            AnalysisSession.status      == "completed",
        ).order_by(AnalysisSession.created_at.desc())
    )
    session = result.scalars().first()
    if session and session.parameters:
        return session.parameters
    return {}
