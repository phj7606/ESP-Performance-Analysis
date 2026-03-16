"""
Mapping configuration from Excel column headers to DB column names.
Written based on the actual headers of 'Production Data.xlsx'.
"""

# Excel original header → SQLAlchemy column name mapping
COLUMN_MAPPING: dict[str, str] = {
    # Control system
    "WELL STATUS WELL STATUS CHOKE (1/128)": "choke",
    "WELL STATUS WELL STATUS WHP (PSI)": "whp",
    "WELL STATUS WELL STATUS FLT (℃)": "flt",
    "WELL STATUS Casing P9-5/8 (PSI)": "casing_pressure",
    "WELL STATUS Casing P13-3/8 (PSI)": "casing_pressure_2",

    # Electrical system
    "ESP VFD FRE. (Hz)": "vfd_freq",
    "ESP Motor Volts (Volts)": "motor_volts",
    "ESP Motor Current (Amps)": "motor_current",
    "ESP Motor power (kW)": "motor_power",
    "ESP Motor Tm (℃)": "motor_temp",
    "ESP Motor Vib (0.001g)": "motor_vib",
    "ESP Motor current leak (uA)": "current_leak",

    # Pressure / temperature system
    "ESP downhole dataPi (PSI)": "pi",
    "ESP downhole dataTi (℃)": "ti",
    "ESP downhole dataPd (PSI)": "pd",
    "ESP downhole datastatic pressure (PSI)": "static_pressure",
    "ESP downhole dataDD (PSI)": "dd",

    # Water analysis
    "Haimo test water cut (%)": "water_cut",
    "Haimo test EMULSION (%)": "emulsion",
    "Haimo  test BS&W (%)": "bsw",

    # Multiphase flow meter (MFM) - pressure/temperature based on actual headers
    "TEST MULTIPHASE FLOW METER DATA pressure (kPa)": "mfm_pressure",
    "TEST MULTIPHASE FLOW METER DATA temperature (℃)": "mfm_temp",

    # Production rates
    "TEST MULTIPHASE FLOW METER DATA liquid (Sm³/d)": "liquid_rate",
    "TEST MULTIPHASE FLOW METER DATA water (Sm³/d)": "water_rate",
    "TEST MULTIPHASE FLOW METER DATA oil (Sm³/d)": "oil_haimo",
    "TEST MULTIPHASE FLOW METER DATA gas (Sm³/d)": "gas_meter",
    "TEST MULTIPHASE FLOW METER DATA dissolved gas oil ratio (Sm³/Sm³)": "gor",

    # Miscellaneous
    "comment ()": "comment",
    "ESP type ()": "esp_type",

    # Pump performance indicators
    "DP cross pump": "dp_cross_pump",
    "Liquid PI": "liquid_pi",
    "Oil   PI": "oil_pi",
}

# Columns recorded only during field tests → allow Null (do not fill with 0)
NULLABLE_COLUMNS: list[str] = [
    "liquid_rate",
    "water_rate",
    "oil_haimo",
    "gas_meter",
    "gor",
]

# Minimum required columns for analysis (validated during upload)
REQUIRED_COLUMNS: list[str] = [
    "vfd_freq",
    "pi",
    "motor_current",
]

# Step 1~3 ML 분석에 필요한 권장 컬럼 (없어도 업로드는 가능하지만 경고 표시)
RECOMMENDED_COLUMNS: list[str] = [
    "motor_power",   # Step 1: 전력 기반 무차원 지수 Cp 계산에 필요
    "motor_temp",    # Step 1: 열 효율 지수 T_eff 계산에 필요
    "motor_vib",     # Step 1/2: 진동 표준편차 V_std (GMM 입력 피처)
    "ti",            # Step 1: 흡입구 온도
    "pd",            # Step 1: 토출 압력
]

# List of numeric measurement columns (included in SET clause during upsert)
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
