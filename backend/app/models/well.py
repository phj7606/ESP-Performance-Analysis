from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import String, Float, DateTime, Integer, func
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
    # 분석 워크플로우 상태 (순서 강제)
    # no_data → data_ready → diagnosis_done → health_done → fully_analyzed
    analysis_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="no_data"
    )
    # 엑셀 시트 순서 — 업로드 시 시트 인덱스를 저장, Home 화면 정렬 기준
    sheet_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationship definitions
    esp_data: Mapped[list["EspDailyData"]] = relationship(
        "EspDailyData", back_populates="well", cascade="all, delete-orphan"
    )


# Deferred import to prevent circular imports
from app.models.esp_data import EspDailyData  # noqa: E402, F401
