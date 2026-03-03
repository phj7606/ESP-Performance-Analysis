"""
Excel 컬럼 헤더 → DB 컬럼명 매핑 설정.
실제 'Production Data.xlsx' 헤더를 기준으로 작성됨.
"""

# Excel 원본 헤더 → SQLAlchemy 컬럼명 매핑
COLUMN_MAPPING: dict[str, str] = {
    # 제어계통
    "WELL STATUS WELL STATUS CHOKE (1/128)": "choke",
    "WELL STATUS WELL STATUS WHP (PSI)": "whp",
    "WELL STATUS WELL STATUS FLT (℃)": "flt",
    "WELL STATUS Casing P9-5/8 (PSI)": "casing_pressure",
    "WELL STATUS Casing P13-3/8 (PSI)": "casing_pressure_2",

    # 전기계통
    "ESP VFD FRE. (Hz)": "vfd_freq",
    "ESP Motor Volts (Volts)": "motor_volts",
    "ESP Motor Current (Amps)": "motor_current",
    "ESP Motor power (kW)": "motor_power",
    "ESP Motor Tm (℃)": "motor_temp",
    "ESP Motor Vib (0.001g)": "motor_vib",
    "ESP Motor current leak (uA)": "current_leak",

    # 압력/온도계통
    "ESP downhole dataPi (PSI)": "pi",
    "ESP downhole dataTi (℃)": "ti",
    "ESP downhole dataPd (PSI)": "pd",
    "ESP downhole datastatic pressure (PSI)": "static_pressure",
    "ESP downhole dataDD (PSI)": "dd",

    # 수분 분석
    "Haimo test water cut (%)": "water_cut",
    "Haimo test EMULSION (%)": "emulsion",
    "Haimo  test BS&W (%)": "bsw",

    # 다상유량계 (MFM) - 압력/온도는 실제 헤더 기준
    "TEST MULTIPHASE FLOW METER DATA pressure (kPa)": "mfm_pressure",
    "TEST MULTIPHASE FLOW METER DATA temperature (℃)": "mfm_temp",

    # 생산량
    "TEST MULTIPHASE FLOW METER DATA liquid (Sm³/d)": "liquid_rate",
    "TEST MULTIPHASE FLOW METER DATA water (Sm³/d)": "water_rate",
    "TEST MULTIPHASE FLOW METER DATA oil (Sm³/d)": "oil_haimo",
    "TEST MULTIPHASE FLOW METER DATA gas (Sm³/d)": "gas_meter",
    "TEST MULTIPHASE FLOW METER DATA dissolved gas oil ratio (Sm³/Sm³)": "gor",

    # 기타
    "comment ()": "comment",
    "ESP type ()": "esp_type",

    # 펌프 성능 지표
    "DP cross pump": "dp_cross_pump",
    "Liquid PI": "liquid_pi",
    "Oil   PI": "oil_pi",
}

# 현장 테스트 시에만 기록되는 컬럼 → Null 허용 (0으로 채우지 않음)
NULLABLE_COLUMNS: list[str] = [
    "liquid_rate",
    "water_rate",
    "oil_haimo",
    "gas_meter",
    "gor",
]

# 분석에 필수적인 최소 컬럼 (업로드 시 존재 여부 검증)
REQUIRED_COLUMNS: list[str] = [
    "vfd_freq",
    "pi",
    "motor_current",
]

# 숫자형 측정 컬럼 목록 (업서트 시 SET 절에 포함)
MEASUREMENT_COLUMNS: list[str] = [
    "choke", "whp", "flt", "casing_pressure", "casing_pressure_2",
    "vfd_freq", "motor_volts", "motor_current", "motor_power",
    "motor_temp", "motor_vib", "current_leak",
    "pi", "ti", "pd", "static_pressure", "dd",
    "water_cut", "emulsion", "bsw",
    "mfm_pressure", "mfm_temp",
    "liquid_rate", "water_rate", "oil_haimo", "gas_meter", "gor",
    "dp_cross_pump", "liquid_pi", "oil_pi",
    "comment", "esp_type",
]
