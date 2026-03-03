from datetime import date
from typing import Optional

from pydantic import BaseModel


class EspDataPoint(BaseModel):
    """단일 날짜의 ESP 센서 데이터"""
    date: date

    # 제어계통
    choke: Optional[float] = None
    whp: Optional[float] = None
    flt: Optional[float] = None
    casing_pressure: Optional[float] = None
    casing_pressure_2: Optional[float] = None

    # 전기계통
    vfd_freq: Optional[float] = None
    motor_volts: Optional[float] = None
    motor_current: Optional[float] = None
    motor_power: Optional[float] = None
    motor_temp: Optional[float] = None
    motor_vib: Optional[float] = None
    current_leak: Optional[float] = None

    # 압력/온도계통
    pi: Optional[float] = None
    ti: Optional[float] = None
    pd: Optional[float] = None
    static_pressure: Optional[float] = None
    dd: Optional[float] = None

    # 수분 분석
    water_cut: Optional[float] = None
    emulsion: Optional[float] = None
    bsw: Optional[float] = None

    # 다상유량계
    mfm_pressure: Optional[float] = None
    mfm_temp: Optional[float] = None

    # 생산량
    liquid_rate: Optional[float] = None
    water_rate: Optional[float] = None
    oil_haimo: Optional[float] = None
    gas_meter: Optional[float] = None
    gor: Optional[float] = None

    # 펌프 성능
    dp_cross_pump: Optional[float] = None
    liquid_pi: Optional[float] = None
    oil_pi: Optional[float] = None

    # 기타
    comment: Optional[str] = None
    esp_type: Optional[str] = None

    model_config = {"from_attributes": True}


class EspDataResponse(BaseModel):
    well_id: str
    data: list[EspDataPoint]
    total: int
    date_range: Optional[dict] = None
