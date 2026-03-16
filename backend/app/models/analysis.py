from datetime import date, datetime
from typing import Optional
import uuid

from sqlalchemy import Date, Float, Integer, Boolean, Text, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import func

from app.db.database import Base


class AnalysisSession(Base):
    """ML analysis session state tracking (Steps 1~3)"""
    __tablename__ = "analysis_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), nullable=False
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    parameters: Mapped[Optional[dict]] = mapped_column(JSONB)
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(255))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BaselinePeriod(Base):
    """Step 2 result: CV 자동 탐지 학습 구간 (GMM 학습에 사용)"""
    __tablename__ = "baseline_periods"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), nullable=False
    )
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    # Training start point: auto-detected from choke/vfd_freq adjustment events or manually entered
    training_start: Mapped[Optional[date]] = mapped_column(Date)
    changepoints: Mapped[Optional[list]] = mapped_column(JSONB)
    is_manually_set: Mapped[bool] = mapped_column(Boolean, default=False)


class ResidualData(Base):
    """Step 1 result: 4개 무차원 성능 지수 시계열 (전체 기간, residual 컬럼은 NULL)"""
    __tablename__ = "residual_data"

    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)

    # 4개 무차원 성능 지수 (일 단위 값)
    cp: Mapped[Optional[float]] = mapped_column(Float)       # 전력 지수: motor_power / (sg × f³)
    psi: Mapped[Optional[float]] = mapped_column(Float)      # 헤드 지수: (pd-pi) / (sg × f²)
    v_std: Mapped[Optional[float]] = mapped_column(Float)    # 진동 지수: motor_vib / f²
    t_eff: Mapped[Optional[float]] = mapped_column(Float)    # 냉각 지수: (motor_temp-ti) / motor_power

    # 각 지수의 30일 이동 평균 (단기 노이즈 제거)
    cp_ma30: Mapped[Optional[float]] = mapped_column(Float)
    psi_ma30: Mapped[Optional[float]] = mapped_column(Float)
    v_std_ma30: Mapped[Optional[float]] = mapped_column(Float)
    t_eff_ma30: Mapped[Optional[float]] = mapped_column(Float)

    # 효율 Proxy: η_proxy = (pd-pi) / motor_power  [단위: psi/kW]
    # 단위 전력당 생성하는 차압 → 낮아질수록 전기→수두 변환 효율 저하
    eta_proxy: Mapped[Optional[float]] = mapped_column(Float)
    eta_proxy_ma30: Mapped[Optional[float]] = mapped_column(Float)

    # 펌프 부하 지수: pump_load_index = power / (ΔP × liquid_rate)
    # liquid_rate는 현장 테스트 시에만 측정 → 다수 날짜에서 NULL 정상
    pump_load_index: Mapped[Optional[float]] = mapped_column(Float)
    pump_load_index_ma30: Mapped[Optional[float]] = mapped_column(Float)

    # Step 3 RUL 입력용: residual = 1 - (ψ / ψ_baseline_mean)
    # 기존 컬럼 재활용 (하위 호환성 유지)
    residual: Mapped[Optional[float]] = mapped_column(Float)
    residual_ma30: Mapped[Optional[float]] = mapped_column(Float)

    # 하위 호환용 NULL 컬럼 (기존 Step 3 스키마와의 충돌 방지)
    predicted: Mapped[Optional[float]] = mapped_column(Float)
    actual: Mapped[Optional[float]] = mapped_column(Float)
    degradation_rate: Mapped[Optional[float]] = mapped_column(Float)


class RulPrediction(Base):
    """Step 3 result: OLS+PI 기반 RUL 예측 (eta_proxy 물리적 임계치 도달 시점)"""
    __tablename__ = "rul_predictions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), nullable=False
    )
    predicted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    rul_median: Mapped[Optional[int]] = mapped_column(Integer)  # P50 중앙값 (일)
    rul_p10: Mapped[Optional[int]] = mapped_column(Integer)     # P10 보수적 (일, 빠른 도달)
    rul_p90: Mapped[Optional[int]] = mapped_column(Integer)     # P90 낙관적 (일, 늦은 도달)
    expected_failure_date: Mapped[Optional[date]] = mapped_column(Date)  # P50 기준 예상 만료일
    # 물리 기반 예측 추가 필드 (OLS+PI 방식)
    model_type: Mapped[Optional[str]] = mapped_column(String(20))  # "linear" | "exponential"
    regression_window: Mapped[Optional[int]] = mapped_column(Integer)  # 회귀에 사용된 N일
    decline_factor: Mapped[Optional[float]] = mapped_column(Float)     # 임계 하락 비율 (예: 0.20)
    baseline_eta: Mapped[Optional[float]] = mapped_column(Float)       # 베이스라인 eta 평균
    failure_threshold_eta: Mapped[Optional[float]] = mapped_column(Float)  # 물리적 임계치 절대값
    forecast_data: Mapped[Optional[list]] = mapped_column(JSONB)       # [{date, eta_p10, eta_p50, eta_p90}, ...]


class HealthScore(Base):
    """Step 2 result: GMM + 마할라노비스 건강 점수 (전체 기간 일별)"""
    __tablename__ = "health_scores"

    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    mahalanobis_distance: Mapped[Optional[float]] = mapped_column(Float)
    health_score: Mapped[Optional[float]] = mapped_column(Float)  # 0~100
    health_status: Mapped[Optional[str]] = mapped_column(String(20))
    # 점수 하락 원인 기여도: 3개 피처의 편차² 비율 (합 = 1.0, hover 인터랙션용 DB 저장)
    contribution_eta:   Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    contribution_v_std: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    contribution_t_eff: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class TrendResidualScore(Base):
    """Step 2-B result: Trend-Residual Health Scoring (전체 기간 일별)
    GMM과 독립적인 MA30 기반 추세-잔차 분리 방식. 장기 하락 탐지에 강점."""
    __tablename__ = "trend_residual_scores"

    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    health_score:  Mapped[Optional[float]] = mapped_column(Float)   # 10~100 (SCORE_FLOOR 보장)
    health_status: Mapped[Optional[str]]   = mapped_column(String(20))
    # 피처별 개별 점수 (Radar 차트: 찌그러진 방향으로 고장 원인 판별)
    score_eta:   Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # η_proxy
    score_v_std: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 진동
    score_t_eff: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 냉각
    # 방향성 Z-score 편차 (MA30 대비, 부호 포함 — Trend Analysis 알고리즘 전환)
    deviation_eta:   Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # η_proxy Z-score
    deviation_v_std: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 진동 Z-score
    deviation_t_eff: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 냉각 Z-score
    # MA30 기울기 정규화 이탈도 (부호 포함: 양수=상승, 음수=하락)
    slope_norm_eta:   Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # η_proxy MA30 기울기
    slope_norm_v_std: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # v_std MA30 기울기
    slope_norm_t_eff: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # t_eff MA30 기울기


class PillarResult(Base):
    """Step 3 result: 3-Pillar 독립 고장 모드 알람 (Hydraulic / Mechanical / Electrical)"""
    __tablename__ = "pillar_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), nullable=False, index=True
    )
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Pillar 1: 유압 성능 (Hydraulic Degradation) — ψ_ma30 Mann-Kendall
    p1_status:       Mapped[Optional[str]]   = mapped_column(String(20))   # normal/warning/critical/unknown
    p1_tau:          Mapped[Optional[float]] = mapped_column(Float)        # Mann-Kendall tau
    p1_pvalue:       Mapped[Optional[float]] = mapped_column(Float)        # Mann-Kendall p-value
    p1_current_val:  Mapped[Optional[float]] = mapped_column(Float)        # 최근 ψ_ma30 값
    p1_baseline_val: Mapped[Optional[float]] = mapped_column(Float)        # 베이스라인 평균
    p1_threshold:    Mapped[Optional[float]] = mapped_column(Float)        # CRITICAL 임계치 (baseline × 0.80)

    # Pillar 2: 기계 진동 (Mechanical Wear) — v_std_ma30 Mann-Kendall
    p2_status:       Mapped[Optional[str]]   = mapped_column(String(20))
    p2_tau:          Mapped[Optional[float]] = mapped_column(Float)
    p2_pvalue:       Mapped[Optional[float]] = mapped_column(Float)
    p2_current_val:  Mapped[Optional[float]] = mapped_column(Float)        # 최근 v_std_ma30 값
    p2_baseline_val: Mapped[Optional[float]] = mapped_column(Float)
    p2_threshold:    Mapped[Optional[float]] = mapped_column(Float)        # CRITICAL 임계치 (baseline × 1.50)

    # Pillar 3: 절연 누설 (Electrical Leakage) — current_leak 절대값 + 지속 조건
    p3_status:         Mapped[Optional[str]]  = mapped_column(String(20))
    p3_current_val:    Mapped[Optional[float]] = mapped_column(Float)      # 최근 이동 중앙값 (μA)
    p3_days_exceeded:  Mapped[Optional[int]]   = mapped_column(Integer)    # 임계치 초과 연속 일수
    p3_data_available: Mapped[Optional[bool]]  = mapped_column(Boolean)

    # Pillar 4: 모터 온도 (Thermal) — motor_temp 7일 이동 중앙값
    p4_status:         Mapped[Optional[str]]   = mapped_column(String(20))  # normal/warning/critical/unknown
    p4_current_val:    Mapped[Optional[float]] = mapped_column(Float)       # 7일 이동 중앙값 (°C)
    p4_data_available: Mapped[Optional[bool]]  = mapped_column(Boolean)
