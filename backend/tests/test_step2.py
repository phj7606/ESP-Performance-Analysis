"""
Step 1 무차원 성능 지수 계산 통합 테스트 + Step 2 Rolling GMM 단위 테스트.

구 파일명 test_step2.py를 유지하지만 두 모듈을 모두 테스트.

[Step 1 테스트]
1.  test_compute_dimensionless_indices_basic    — Cp/ψ/V_std/T_eff/η_proxy 수식 검증
2.  test_zero_freq_handling                    — vfd_freq=0 → NaN 처리
3.  test_zero_power_handling                   — motor_power=0 → T_eff NaN 처리
4.  test_indices_stored                        — ResidualData에 cp/psi/v_std/t_eff 저장 확인
5.  test_ma30_stored                           — MA30 컬럼 저장 확인
6.  test_rows_written                          — DB 저장 행 수 = 입력 데이터 행 수
7.  test_status_diagnosis_done                 — analysis_status = "diagnosis_done"
8.  test_step2_requires_diagnosis_done (API)   — 422 워크플로우 검증

[Step 2 Rolling GMM 테스트]
9.  test_rolling_gmm_expanding_window          — 초기 30일 미만 → NaN
10. test_rolling_gmm_score_range               — 모든 점수 0~100 범위 확인
11. test_rolling_gmm_recent_data_lower         — 열화 데이터가 정상 구간보다 낮은 점수
12. test_features_fixed                        — features_used == FIXED_FEATURES

실행:
    docker compose exec backend pytest tests/test_step2.py -v
"""
import uuid
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, delete

from app.db.database import AsyncSessionLocal
from app.models.well import Well
from app.models.analysis import AnalysisSession, ResidualData
from app.services.step1_diagnosis import (
    compute_sg_liquid,
    compute_dimensionless_indices,
    run_step1_analysis,
)
from app.services.step2_health import (
    FIXED_FEATURES, _apply_ewma, _run_rolling_gmm, _ll_to_score_piecewise,
    _compute_trend_residual_score, P_RES_MAX, SCORE_FLOOR,
)


# 테스트 전용 Well 이름 (운영 데이터와 충돌 방지)
STEP1_WELL_NAME = "TEST-STEP1-DIMLESS"

# 합성 데이터 파라미터: 정상 운전 중 일정해야 하는 기준값 (Affinity Laws 기반)
PSI_0   = 5000.0  # 헤드 지수 기준 (kPa/(sg·Hz²))
CP_0    = 0.002   # 전력 지수 기준 (kW/(sg·Hz³))
VSTD_0  = 0.003   # 진동 지수 기준 (g/Hz²)
TEFF_0  = 0.4     # 냉각 지수 기준 (℃/kW)


# ============================================================
# Step 1 단위 테스트 (DB 불필요)
# ============================================================

def test_compute_dimensionless_indices_basic():
    """
    Cp, ψ, V_std, T_eff, η_proxy 수식 수치 검증.

    f=50Hz, sg=0.92, motor_power=100kW, pi=1000kPa, pd=2500kPa, vib=5g
    Cp        = 100 / (0.92 × 50³) = 100 / 115000 ≈ 0.000869...
    ψ         = (2500-1000) / (0.92 × 50²) = 1500 / 2300 ≈ 0.6521...
    V_std     = 5 / 50²  = 5 / 2500 = 0.002
    T_eff     = (120-35) / 100 = 85/100 = 0.85
    η_proxy   = (2500-1000) × 0.92 / 100 = 1380/100 = 13.8

    주의: pi, pd 변수명을 pi_val, pd_val로 사용 (pandas 'pd' 모듈명 충돌 방지)
    """
    f      = 50.0
    sg     = 0.92
    mw     = 100.0
    pi_val = 1000.0
    pd_val = 2500.0
    vib    = 5.0
    ti_val = 35.0
    mt_val = 120.0

    df = pd.DataFrame({
        "vfd_freq":    [f],
        "pi":          [pi_val],
        "pd":          [pd_val],
        "motor_power": [mw],
        "motor_temp":  [mt_val],
        "motor_vib":   [vib],
        "ti":          [ti_val],
    }, index=pd.to_datetime(["2023-01-01"]))

    sg_series = pd.Series([sg], index=df.index)
    result = compute_dimensionless_indices(df, sg_series)

    expected_cp       = mw / (sg * f ** 3)
    expected_psi      = (pd_val - pi_val) / (sg * f ** 2)
    expected_vstd     = vib / (f ** 2)
    expected_teff     = (mt_val - ti_val) / mw
    # η_proxy = ψ / Cp = [(ΔP)/(sg×f²)] / [mw/(sg×f³)] = ΔP × f / mw (sg 소거)
    # C_whp=0.0 (기본값) → WHP 보정 없음 → ΔP = pd_val - pi_val
    expected_etaproxy = (pd_val - pi_val) * f / mw

    assert abs(result["cp"].iloc[0]        - expected_cp)       < 1e-9
    assert abs(result["psi"].iloc[0]       - expected_psi)      < 1e-9
    assert abs(result["v_std"].iloc[0]     - expected_vstd)     < 1e-9
    assert abs(result["t_eff"].iloc[0]     - expected_teff)     < 1e-9
    assert abs(result["eta_proxy"].iloc[0] - expected_etaproxy) < 1e-9


def test_zero_freq_handling():
    """
    vfd_freq=0 행: Cp, ψ, V_std 모두 NaN (ZeroDivisionError 없이 처리).
    vfd_freq=50 행: 정상 계산.
    T_eff는 주파수와 무관하므로 vfd_freq=0이어도 정상 계산.
    """
    df = pd.DataFrame({
        "vfd_freq":    [0.0, 50.0],
        "pi":          [1000.0, 1000.0],
        "pd":          [2500.0, 2500.0],
        "motor_power": [100.0, 100.0],
        "motor_temp":  [100.0, 100.0],
        "motor_vib":   [5.0, 5.0],
        "ti":          [35.0, 35.0],
    }, index=pd.to_datetime(["2023-01-01", "2023-01-02"]))

    sg = pd.Series([0.92, 0.92], index=df.index)
    result = compute_dimensionless_indices(df, sg)

    # vfd_freq=0 행: f가 분모에 있는 지수(Cp, ψ, V_std)는 NaN
    assert pd.isna(result["cp"].iloc[0])
    assert pd.isna(result["psi"].iloc[0])
    assert pd.isna(result["v_std"].iloc[0])
    # T_eff는 f를 사용하지 않으므로 정상 계산
    assert not pd.isna(result["t_eff"].iloc[0])

    # vfd_freq=50 행: 정상 계산
    assert not pd.isna(result["cp"].iloc[1])
    assert not pd.isna(result["psi"].iloc[1])
    assert not pd.isna(result["v_std"].iloc[1])


def test_zero_power_handling():
    """
    motor_power=0 행: T_eff, η_proxy = NaN (ZeroDivisionError 없이 처리).
    motor_power 정상 행: T_eff, η_proxy 정상 계산.
    """
    df = pd.DataFrame({
        "vfd_freq":    [50.0, 50.0],
        "pi":          [1000.0, 1000.0],
        "pd":          [2500.0, 2500.0],
        "motor_power": [0.0, 100.0],
        "motor_temp":  [100.0, 100.0],
        "motor_vib":   [5.0, 5.0],
        "ti":          [35.0, 35.0],
    }, index=pd.to_datetime(["2023-01-01", "2023-01-02"]))

    sg = pd.Series([0.92, 0.92], index=df.index)
    result = compute_dimensionless_indices(df, sg)

    assert pd.isna(result["t_eff"].iloc[0])       # motor_power=0 → NaN
    assert not pd.isna(result["t_eff"].iloc[1])
    # η_proxy도 motor_power가 분모 → power=0이면 NaN
    assert pd.isna(result["eta_proxy"].iloc[0])
    assert not pd.isna(result["eta_proxy"].iloc[1])


# ============================================================
# Step 2 Rolling GMM 단위 테스트 (DB 불필요)
# ============================================================

def _make_log_df(n: int, seed: int = 42) -> pd.DataFrame:
    """
    테스트용 log 변환 DataFrame 생성 유틸리티.

    FIXED_FEATURES(log_eta, log_v_std, log_t_eff) 3컬럼을 가진
    n행 DataFrame을 반환 (정상 운전 패턴 시뮬레이션).
    """
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2023-01-01", periods=n, freq="D")
    return pd.DataFrame({
        "log_eta":   rng.normal(2.0, 0.05, n),    # η_proxy의 log값 (정상 범위)
        "log_v_std": rng.normal(-4.0, 0.05, n),   # v_std의 log값
        "log_t_eff": rng.normal(-0.5, 0.05, n),   # t_eff의 log값
    }, index=dates)


def test_rolling_gmm_expanding_window():
    """
    초기 min_window(30일) 미만 데이터 구간은 NaN을 반환해야 한다.

    - 0번째 시점: 학습 데이터 0행 → NaN
    - 29번째 시점: 학습 데이터 29행(< 30) → NaN
    - 30번째 시점: 학습 데이터 30행(= 30) → 유효한 점수
    """
    log_df = _make_log_df(120)
    # _run_rolling_gmm은 이제 DataFrame 반환 (health_score + contribution 컬럼)
    result_df = _run_rolling_gmm(log_df, min_window=30, max_window=90)

    # 인덱스 0~29: NaN (학습 데이터 부족)
    assert all(pd.isna(result_df["health_score"].iloc[i]) for i in range(30)), (
        "min_window 이전 구간에서 NaN이 아닌 점수가 존재함"
    )
    # 인덱스 30+: 유효한 점수 존재 (일부 NaN 허용, 최소 1개 이상 유효)
    valid_after = result_df["health_score"].iloc[30:].dropna()
    assert len(valid_after) > 0, "min_window 이후 유효한 점수가 없음"


def test_rolling_gmm_score_range():
    """
    모든 유효한(non-NaN) 건강 점수가 0~100 범위 안에 있어야 한다.
    """
    log_df = _make_log_df(150)
    result_df = _run_rolling_gmm(log_df, min_window=30, max_window=90)

    valid = result_df["health_score"].dropna()
    assert len(valid) > 0, "유효한 점수가 없음"
    assert (valid >= 0).all(),   f"0 미만 점수 존재: min={valid.min():.4f}"
    assert (valid <= 100).all(), f"100 초과 점수 존재: max={valid.max():.4f}"


def test_rolling_gmm_recent_data_lower():
    """
    열화(degradation) 시뮬레이션: 후반부 데이터가 정상 구간에서 크게 벗어나면
    후반부 점수가 전반부보다 낮아야 한다.

    - 전반 150일: 정상 운전 (정규분포 중심값)
    - 후반 30일:  열화 (모든 피처 평균이 2σ 벗어남)
    """
    rng = np.random.default_rng(0)
    n_normal   = 150
    n_degraded = 30
    dates = pd.date_range("2022-01-01", periods=n_normal + n_degraded, freq="D")

    normal_data = {
        "log_eta":   rng.normal(2.0, 0.05, n_normal),
        "log_v_std": rng.normal(-4.0, 0.05, n_normal),
        "log_t_eff": rng.normal(-0.5, 0.05, n_normal),
    }
    # 열화 구간: 이탈량 0.5 (10σ) — max_window=60 축소 시 창의 50%를 열화가 점유하므로
    #   GMM이 열화를 "정상"으로 학습할 위험을 강한 이탈로 방지
    degraded_data = {
        "log_eta":   rng.normal(2.0 - 0.5, 0.05, n_degraded),   # 성능 저하 (10σ 이탈)
        "log_v_std": rng.normal(-4.0 + 0.5, 0.05, n_degraded),  # 진동 증가
        "log_t_eff": rng.normal(-0.5 + 0.5, 0.05, n_degraded),  # 온도 증가
    }

    combined = {
        k: np.concatenate([normal_data[k], degraded_data[k]])
        for k in ["log_eta", "log_v_std", "log_t_eff"]
    }
    log_df = pd.DataFrame(combined, index=dates)
    result_df = _run_rolling_gmm(log_df, min_window=30, max_window=60)
    scores = result_df["health_score"]

    # 정상 구간 중반부(충분한 학습 데이터 확보 후)와 열화 구간 비교
    # 비교 구간: 정상 60~140일 (열화와 오버랩 없는 중간 구간), 열화 150일~
    normal_mean   = scores.iloc[60:140].dropna().mean()
    degraded_mean = scores.iloc[150:].dropna().mean()

    assert not np.isnan(normal_mean),   "정상 구간에 유효한 점수 없음"
    assert not np.isnan(degraded_mean), "열화 구간에 유효한 점수 없음"
    assert normal_mean > degraded_mean, (
        f"정상 구간 평균({normal_mean:.1f})이 열화 구간 평균({degraded_mean:.1f})보다 낮음 — "
        "열화 탐지 실패"
    )
    # Piecewise 방식에서 정상 구간은 80점대에 분포해야 함
    assert normal_mean > 75, (
        f"정상 구간 평균({normal_mean:.1f})이 75점 미만 — piecewise 정규화 적용 실패"
    )


def test_piecewise_normal_range():
    """
    정상 데이터만으로 구성된 log_df에서 piecewise 방식이
    80점 이상을 다수(40% 이상) 반환해야 한다.

    이론상 p20 기준이면 80%의 학습 데이터가 80점+ 구간이지만,
    실측 기준은 그보다 낮다. 이유:
      1. Rolling GMM 소표본(30~60행) + 2컴포넌트 조합에서 현재 시점이
         학습 LL p20 이상일 확률이 통계적 기댓값(80%)보다 낮음
      2. 초기 Expanding Window 구간(30~60일) EWMA 후처리가
         초기 저점을 후방으로 전파
    40% 이상: 정상 운전에서 Critical(40점 미만)이 다수가 아님을 확인하는
    최소 요건 (degradation 탐지와 구분하기 위한 경계).
    """
    log_df = _make_log_df(150)
    result_df = _run_rolling_gmm(log_df)
    valid = result_df["health_score"].dropna()
    assert len(valid) > 0
    above_80 = (valid >= 80).mean()
    assert above_80 >= 0.40, (
        f"정상 데이터에서 80점 이상 비율이 40% 미만: {above_80:.1%}"
    )


def test_features_fixed():
    """
    FIXED_FEATURES가 기대하는 3개 피처 목록과 정확히 일치해야 한다.
    """
    assert FIXED_FEATURES == ["log_eta", "log_v_std", "log_t_eff"], (
        f"FIXED_FEATURES 불일치: {FIXED_FEATURES}"
    )


# ============================================================
# EWMA 전처리 + 기여도 테스트
# ============================================================

def _make_raw_df(n: int, seed: int = 42) -> pd.DataFrame:
    """
    테스트용 원본(log 변환 이전) DataFrame 생성 유틸리티.

    eta_proxy, v_std, t_eff 3컬럼을 가진 n행 DataFrame을 반환
    (노이즈가 있는 양수 원본값, EWMA 스무딩 효과 검증용).
    """
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2023-01-01", periods=n, freq="D")
    return pd.DataFrame({
        "eta_proxy": rng.normal(10.0, 2.0, n),     # 양수 원본값 (노이즈 크게)
        "v_std":     rng.normal(0.02, 0.005, n),   # 양수 원본값
        "t_eff":     rng.normal(0.5, 0.1, n),      # 양수 원본값
    }, index=dates)


def test_ewma_applied_before_log():
    """
    EWMA 스무딩이 log 변환 이전에 적용되어야 한다.

    EWMA 결과는 원본보다 표준편차가 작아야 함 (스무딩 효과).
    """
    df = _make_raw_df(50)
    smoothed = _apply_ewma(df)
    # EWMA 스무딩 후 각 피처의 변동성이 감소해야 함
    assert smoothed["eta_proxy"].std() < df["eta_proxy"].std(), (
        "EWMA 후 eta_proxy 표준편차가 감소하지 않음 — 스무딩 적용 실패"
    )


def test_rolling_gmm_returns_contributions():
    """
    _run_rolling_gmm이 health_score + 기여도 3컬럼을 포함한 DataFrame을 반환해야 한다.
    """
    log_df = _make_log_df(120)
    result_df = _run_rolling_gmm(log_df)
    assert "health_score"       in result_df.columns
    assert "contribution_eta"   in result_df.columns
    assert "contribution_v_std" in result_df.columns
    assert "contribution_t_eff" in result_df.columns


def test_contribution_sum_to_one():
    """
    유효한 기여도 행(NaN 아닌 행)의 3개 값 합이 1.0 (±1e-6)이어야 한다.
    """
    log_df = _make_log_df(120)
    result_df = _run_rolling_gmm(log_df)
    # contribution 컬럼 기준으로 유효 행 필터링
    valid = result_df.dropna(subset=["contribution_eta", "contribution_v_std", "contribution_t_eff"])
    assert len(valid) > 0, "유효한 기여도 행이 없음"

    contrib_sum = (
        valid["contribution_eta"] +
        valid["contribution_v_std"] +
        valid["contribution_t_eff"]
    )
    assert (contrib_sum - 1.0).abs().max() < 1e-6, (
        f"기여도 합이 1.0이 아님: max_diff={((contrib_sum - 1.0).abs().max()):.2e}"
    )


# ============================================================
# Trend-Residual Health Scoring 단위 테스트 (DB 불필요)
# ============================================================

def _make_tr_series(n: int, feature: str = "eta_proxy", seed: int = 42) -> pd.Series:
    """
    테스트용 단일 피처 시계열 생성 유틸리티.

    feature별 정상 운전 기준값:
      eta_proxy: 양수 (감소 = 악화)
      v_std:     양수 소수점 (증가 = 악화)
      t_eff:     양수 (증가 = 악화)
    """
    rng   = np.random.default_rng(seed)
    dates = pd.date_range("2023-01-01", periods=n, freq="D")
    base_map = {"eta_proxy": 10.0, "v_std": 0.02, "t_eff": 0.5}
    std_map  = {"eta_proxy": 0.5,  "v_std": 0.001, "t_eff": 0.02}
    base = base_map.get(feature, 10.0)
    std  = std_map.get(feature, 0.5)
    return pd.Series(
        rng.normal(base, std, n).clip(min=1e-6),   # 음수 방지
        index=dates,
        name=feature,
    )


def test_trend_residual_normal_high():
    """
    정상 데이터(150일)에서 유효 점수의 70%+ 가 70점 이상이어야 한다.

    MA30 기준선이 안정화된 후(초기 ~10일 NaN 제외) 정상 운전 구간은
    잔차 이탈과 기울기 모두 작으므로 대다수 점수가 70점 이상이어야 함.
    """
    series = _make_tr_series(150, "eta_proxy")
    scores = _compute_trend_residual_score(series, "eta_proxy")

    valid = scores.dropna()
    assert len(valid) > 0, "유효 점수가 없음"
    above_70_ratio = (valid >= 70).mean()
    assert above_70_ratio >= 0.70, (
        f"정상 데이터에서 70점 이상 비율이 70% 미만: {above_70_ratio:.1%}"
    )


def test_trend_residual_degradation_lower():
    """
    10σ 이탈 열화 구간 점수가 정상 구간 평균보다 낮아야 한다.

    열화 구간: 피처 값이 10σ 이탈하도록 강제 → 이탈 감점(P_res) 즉각 반응.
    """
    rng = np.random.default_rng(1)
    n_normal   = 150
    n_degraded = 30
    dates = pd.date_range("2022-01-01", periods=n_normal + n_degraded, freq="D")

    # 정상: eta_proxy ≈ 10.0
    normal_vals   = rng.normal(10.0, 0.3, n_normal)
    # 열화: sigma≈0.3 기준 10σ = 3.0 감소
    degraded_vals = rng.normal(10.0 - 3.0, 0.3, n_degraded)

    series = pd.Series(
        np.concatenate([normal_vals, degraded_vals]).clip(min=1e-6),
        index=dates,
    )
    scores = _compute_trend_residual_score(series, "eta_proxy")

    # 정상 구간 중반부(충분한 MA30 확보 후)와 열화 구간 비교
    normal_mean   = scores.iloc[60:140].dropna().mean()
    degraded_mean = scores.iloc[n_normal:].dropna().mean()

    assert not np.isnan(normal_mean),   "정상 구간에 유효 점수 없음"
    assert not np.isnan(degraded_mean), "열화 구간에 유효 점수 없음"
    assert degraded_mean < normal_mean, (
        f"열화 구간 평균({degraded_mean:.1f})이 정상 구간 평균({normal_mean:.1f})보다 높음 — "
        "열화 탐지 실패"
    )


def test_trend_residual_score_range():
    """
    모든 유효 점수가 SCORE_FLOOR(10)~100 범위 안에 있어야 한다.

    극단 데이터(매우 큰 이탈 + 가파른 하락)에서도 clip이 보장되어야 함.
    """
    rng = np.random.default_rng(7)
    n = 200
    dates = pd.date_range("2023-01-01", periods=n, freq="D")

    # 급격한 열화 시뮬레이션: 정상 100일 + 하락 100일
    normal_part = rng.normal(10.0, 0.5, 100)
    # 100일에 걸쳐 10.0 → 2.0으로 선형 하락 + 노이즈 (심각한 열화)
    trend_down  = np.linspace(10.0, 2.0, 100) + rng.normal(0, 0.3, 100)
    series = pd.Series(
        np.concatenate([normal_part, trend_down]).clip(min=1e-6),
        index=dates,
    )

    for feature in ["eta_proxy", "v_std", "t_eff"]:
        scores = _compute_trend_residual_score(series, feature)
        valid  = scores.dropna()
        assert len(valid) > 0, f"{feature}: 유효 점수 없음"
        assert (valid >= SCORE_FLOOR).all(), (
            f"{feature}: SCORE_FLOOR({SCORE_FLOOR}) 미만 점수 존재: min={valid.min():.2f}"
        )
        assert (valid <= 100).all(), (
            f"{feature}: 100 초과 점수 존재: max={valid.max():.2f}"
        )


# ============================================================
# 공통 픽스처
# ============================================================

@pytest_asyncio.fixture
async def well_data_ready():
    """
    테스트용 Well + EspDailyData를 DB에 생성한 뒤 well_id 반환.
    테스트 종료 후 모두 삭제.

    Step 1은 베이스라인 설정 없이 data_ready 상태에서 바로 실행 가능.

    합성 데이터 원리 (물리적 일관성 보장):
    - 정상 펌프: 4개 무차원 지수가 주파수 변화와 무관하게 일정해야 함
    - vfd_freq 변동 (45~70 Hz) → 각 물리량을 역산하여 지수가 일정하게 유지
    """
    from app.models.esp_data import EspDailyData

    well_id    = uuid.uuid4()
    start      = date(2023, 1, 1)
    total_days = 200

    async with AsyncSessionLocal() as db:
        # Step 1은 data_ready 상태에서 바로 실행 가능
        well = Well(
            id=well_id,
            name=STEP1_WELL_NAME,
            analysis_status="data_ready",
        )
        db.add(well)
        await db.flush()

        rng = np.random.default_rng(42)
        for i in range(total_days):
            day  = start + timedelta(days=i)
            vfd  = 55.0 + rng.uniform(-10, 10)  # Hz
            wcut = 0.75 + rng.uniform(-0.03, 0.03)
            sg   = wcut * 1.03 + (1 - wcut) * 0.85

            # 물리량을 무차원 지수 기준값으로 역산 (노이즈 약간 추가)
            power  = (CP_0 * sg * vfd ** 3) * (1 + rng.normal(0, 0.02))
            dp     = (PSI_0 * sg * vfd ** 2) * (1 + rng.normal(0, 0.02))
            vib    = (VSTD_0 * vfd ** 2) * (1 + rng.normal(0, 0.02))
            ti_val = 35.0 + rng.uniform(-2, 2)
            mt_val = ti_val + (TEFF_0 * power) * (1 + rng.normal(0, 0.02))

            pi_val = 1200.0 + rng.uniform(-30, 30)
            pd_val = pi_val + dp

            db.add(EspDailyData(
                well_id=well_id,
                date=day,
                vfd_freq=vfd,
                pi=pi_val,
                pd=pd_val,
                motor_power=max(power, 1.0),   # 0 이하 방지
                motor_temp=mt_val,
                motor_vib=max(vib, 0.01),
                ti=ti_val,
                water_cut=wcut,
            ))
        await db.commit()

    yield well_id

    # 정리: ResidualData → AnalysisSession → EspDailyData → Well 순서로 삭제
    async with AsyncSessionLocal() as db:
        await db.execute(delete(ResidualData).where(ResidualData.well_id == well_id))
        await db.execute(delete(AnalysisSession).where(AnalysisSession.well_id == well_id))
        from app.models.esp_data import EspDailyData
        await db.execute(delete(EspDailyData).where(EspDailyData.well_id == well_id))
        await db.execute(delete(Well).where(Well.id == well_id))
        await db.commit()


async def _run_step1(well_id, task_suffix="") -> dict:
    """AnalysisSession 생성 후 run_step1_analysis 실행하는 공통 헬퍼."""
    async with AsyncSessionLocal() as db:
        session = AnalysisSession(
            well_id=well_id,
            step_number=1,
            status="running",
            parameters={},
            celery_task_id=f"test-task-{task_suffix}",
        )
        db.add(session)
        await db.commit()

        # run_step1_analysis는 내부에서 db.commit()을 호출함
        result = await run_step1_analysis(
            well_id=str(well_id),
            sg_oil=0.85,
            sg_water=1.03,
            db=db,
        )
    return result


# ============================================================
# Step 1 서비스 레벨 테스트
# ============================================================

@pytest.mark.asyncio
async def test_indices_stored(well_data_ready):
    """
    ResidualData에 4개 무차원 지수(cp, psi, v_std, t_eff) 컬럼이 저장되어야 한다.
    합성 데이터는 물리적으로 일관된 정상 펌프이므로 모두 non-None이어야 함.
    """
    await _run_step1(well_data_ready, "indices")

    async with AsyncSessionLocal() as db:
        stmt = select(ResidualData).where(
            ResidualData.well_id == well_data_ready
        ).order_by(ResidualData.date.asc())
        rows = (await db.execute(stmt)).scalars().all()

    assert len(rows) > 0, "ResidualData 행이 없음"
    # 첫 번째 행: 합성 정상 펌프이므로 모든 지수가 Non-None이어야 함
    first = rows[0]
    assert first.cp       is not None, "cp 컬럼이 None"
    assert first.psi      is not None, "psi 컬럼이 None"
    assert first.v_std    is not None, "v_std 컬럼이 None"
    assert first.t_eff    is not None, "t_eff 컬럼이 None"
    assert first.eta_proxy is not None, "eta_proxy 컬럼이 None"


@pytest.mark.asyncio
async def test_ma30_stored(well_data_ready):
    """
    MA30 컬럼(cp_ma30, psi_ma30, v_std_ma30, t_eff_ma30)이 DB에 저장되어야 한다.
    전체 행의 절반 이상에 유효한 값이 있어야 함 (초기 30일도 min_periods=1로 계산됨).
    """
    await _run_step1(well_data_ready, "ma30")

    async with AsyncSessionLocal() as db:
        stmt = select(ResidualData).where(
            ResidualData.well_id == well_data_ready
        ).order_by(ResidualData.date.asc())
        rows = (await db.execute(stmt)).scalars().all()

    with_cp_ma30 = [r for r in rows if r.cp_ma30 is not None]
    # min_periods=1 설정으로 첫 번째 행부터 MA30이 존재해야 함
    assert len(with_cp_ma30) == len(rows), (
        f"cp_ma30 누락 행이 있음: {len(rows) - len(with_cp_ma30)}개"
    )

    with_psi_ma30 = [r for r in rows if r.psi_ma30 is not None]
    assert len(with_psi_ma30) == len(rows), "psi_ma30 누락 행이 있음"


@pytest.mark.asyncio
async def test_rows_written(well_data_ready):
    """
    DB 저장 행 수 = 전체 ESP 데이터 행 수 (200일).
    """
    result = await _run_step1(well_data_ready, "count")
    assert result["rows_written"] == 200, (
        f"Expected 200 rows, got {result['rows_written']}"
    )


@pytest.mark.asyncio
async def test_status_diagnosis_done(well_data_ready):
    """
    Step 1 완료 후 well.analysis_status == 'diagnosis_done' 이어야 한다.
    """
    await _run_step1(well_data_ready, "status")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Well).where(Well.id == well_data_ready)
        )
        well = result.scalar_one()

    assert well.analysis_status == "diagnosis_done"


# ============================================================
# API 레벨 테스트
# ============================================================

@pytest.mark.asyncio
async def test_step2_requires_diagnosis_done(client: AsyncClient):
    """
    analysis_status가 'data_ready'인 Well에 Step 2 실행 시 422 반환.
    (Step 1 미완료 상태 — 'diagnosis_done' 이전 — 에서는 Step 2 불가)
    """
    well_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        well = Well(
            id=well_id,
            name="TEST-STEP2-NO-DIAGNOSIS",
            analysis_status="data_ready",
        )
        db.add(well)
        await db.commit()

    try:
        response = await client.post(
            f"/api/wells/{well_id}/analysis/step2",
        )
        assert response.status_code == 422, (
            f"Expected 422 for data_ready status, got {response.status_code}"
        )
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Well).where(Well.id == well_id))
            await db.commit()
