from datetime import date
from typing import Optional

from pydantic import BaseModel


class EspDataPoint(BaseModel):
    """ESP sensor data for a single date"""
    date: date

    # Control system
    choke: Optional[float] = None
    whp: Optional[float] = None
    flt: Optional[float] = None
    casing_pressure: Optional[float] = None
    casing_pressure_2: Optional[float] = None

    # Electrical system
    vfd_freq: Optional[float] = None
    motor_volts: Optional[float] = None
    motor_current: Optional[float] = None
    motor_power: Optional[float] = None
    motor_temp: Optional[float] = None
    motor_vib: Optional[float] = None
    current_leak: Optional[float] = None

    # Pressure / temperature system
    pi: Optional[float] = None
    ti: Optional[float] = None
    pd: Optional[float] = None
    static_pressure: Optional[float] = None
    dd: Optional[float] = None

    # Water analysis
    water_cut: Optional[float] = None
    emulsion: Optional[float] = None
    bsw: Optional[float] = None

    # Multiphase flow meter
    mfm_pressure: Optional[float] = None
    mfm_temp: Optional[float] = None

    # Production rates
    liquid_rate: Optional[float] = None
    water_rate: Optional[float] = None
    oil_haimo: Optional[float] = None
    gas_meter: Optional[float] = None
    gor: Optional[float] = None

    # Pump performance
    dp_cross_pump: Optional[float] = None
    liquid_pi: Optional[float] = None
    oil_pi: Optional[float] = None

    # Miscellaneous
    comment: Optional[str] = None
    esp_type: Optional[str] = None

    model_config = {"from_attributes": True}


class EspDataResponse(BaseModel):
    well_id: str
    data: list[EspDataPoint]
    total: int
    date_range: Optional[dict] = None
