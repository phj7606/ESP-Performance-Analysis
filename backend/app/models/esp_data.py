from datetime import date
from typing import Optional
import uuid

from sqlalchemy import Date, Float, Text, String, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class EspDailyData(Base):
    __tablename__ = "esp_daily_data"

    well_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wells.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)

    # 제어계통
    choke: Mapped[Optional[float]] = mapped_column(Float)
    whp: Mapped[Optional[float]] = mapped_column(Float)
    flt: Mapped[Optional[float]] = mapped_column(Float)
    casing_pressure: Mapped[Optional[float]] = mapped_column(Float)
    casing_pressure_2: Mapped[Optional[float]] = mapped_column(Float)

    # 전기계통
    vfd_freq: Mapped[Optional[float]] = mapped_column(Float)
    motor_volts: Mapped[Optional[float]] = mapped_column(Float)
    motor_current: Mapped[Optional[float]] = mapped_column(Float)
    motor_power: Mapped[Optional[float]] = mapped_column(Float)
    motor_temp: Mapped[Optional[float]] = mapped_column(Float)
    motor_vib: Mapped[Optional[float]] = mapped_column(Float)
    current_leak: Mapped[Optional[float]] = mapped_column(Float)

    # 압력/온도계통
    pi: Mapped[Optional[float]] = mapped_column(Float)
    ti: Mapped[Optional[float]] = mapped_column(Float)
    pd: Mapped[Optional[float]] = mapped_column(Float)
    static_pressure: Mapped[Optional[float]] = mapped_column(Float)
    dd: Mapped[Optional[float]] = mapped_column(Float)

    # 수분 분석
    water_cut: Mapped[Optional[float]] = mapped_column(Float)
    emulsion: Mapped[Optional[float]] = mapped_column(Float)
    bsw: Mapped[Optional[float]] = mapped_column(Float)

    # 다상유량계 (MFM)
    mfm_pressure: Mapped[Optional[float]] = mapped_column(Float)
    mfm_temp: Mapped[Optional[float]] = mapped_column(Float)

    # 생산량 (현장 테스트 시에만 기록 → Null 다수)
    liquid_rate: Mapped[Optional[float]] = mapped_column(Float)
    water_rate: Mapped[Optional[float]] = mapped_column(Float)
    oil_haimo: Mapped[Optional[float]] = mapped_column(Float)
    gas_meter: Mapped[Optional[float]] = mapped_column(Float)
    gor: Mapped[Optional[float]] = mapped_column(Float)

    # 펌프 성능 지표
    dp_cross_pump: Mapped[Optional[float]] = mapped_column(Float)
    liquid_pi: Mapped[Optional[float]] = mapped_column(Float)
    oil_pi: Mapped[Optional[float]] = mapped_column(Float)

    # 기타
    comment: Mapped[Optional[str]] = mapped_column(Text)
    esp_type: Mapped[Optional[str]] = mapped_column(String(50))

    well: Mapped["Well"] = relationship("Well", back_populates="esp_data")


from app.models.well import Well  # noqa: E402, F401
