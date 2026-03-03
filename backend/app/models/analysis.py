from datetime import date, datetime
from typing import Optional
import uuid

from sqlalchemy import Date, Float, Integer, Boolean, Text, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import func

from app.db.database import Base


class AnalysisSession(Base):
    """ML 분석 세션 상태 추적 (Step 1~4)"""
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
    """Step 1 결과: PELT 변화점 + 베이스라인 구간"""
    __tablename__ = "baseline_periods"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), nullable=False
    )
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    changepoints: Mapped[Optional[list]] = mapped_column(JSONB)
    is_manually_set: Mapped[bool] = mapped_column(Boolean, default=False)


class ResidualData(Base):
    """Step 2 결과: Ridge 회귀 잔차 시계열"""
    __tablename__ = "residual_data"

    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    predicted: Mapped[Optional[float]] = mapped_column(Float)
    actual: Mapped[Optional[float]] = mapped_column(Float)
    residual: Mapped[Optional[float]] = mapped_column(Float)
    residual_ma30: Mapped[Optional[float]] = mapped_column(Float)
    degradation_rate: Mapped[Optional[float]] = mapped_column(Float)


class RulPrediction(Base):
    """Step 3 결과: Wiener 프로세스 기반 RUL 예측"""
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
    rul_median: Mapped[Optional[int]] = mapped_column(Integer)  # P50
    rul_p10: Mapped[Optional[int]] = mapped_column(Integer)     # 낙관 예측
    rul_p90: Mapped[Optional[int]] = mapped_column(Integer)     # 보수적 예측
    expected_failure_date: Mapped[Optional[date]] = mapped_column(Date)
    wiener_drift: Mapped[Optional[float]] = mapped_column(Float)
    wiener_diffusion: Mapped[Optional[float]] = mapped_column(Float)


class HealthScore(Base):
    """Step 4 결과: GMM + 마할라노비스 건강 점수"""
    __tablename__ = "health_scores"

    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    mahalanobis_distance: Mapped[Optional[float]] = mapped_column(Float)
    health_score: Mapped[Optional[float]] = mapped_column(Float)  # 0~100
    health_status: Mapped[Optional[str]] = mapped_column(String(20))
