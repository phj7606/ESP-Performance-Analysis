from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, Float, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Well(Base):
    __tablename__ = "wells"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    field: Mapped[Optional[str]] = mapped_column(String(100))
    latest_health_score: Mapped[Optional[float]] = mapped_column(Float)
    # 분석 워크플로우 상태 (no_data → data_ready → baseline_set → ... → fully_analyzed)
    analysis_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="no_data"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # 관계 정의
    esp_data: Mapped[list["EspDailyData"]] = relationship(
        "EspDailyData", back_populates="well", cascade="all, delete-orphan"
    )


# 순환 임포트 방지를 위한 지연 임포트
from app.models.esp_data import EspDailyData  # noqa: E402, F401
