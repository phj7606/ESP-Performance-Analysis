-- TimescaleDB 및 UUID 확장 활성화
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Well 정보 테이블
CREATE TABLE IF NOT EXISTS wells (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    field VARCHAR(100),
    latest_health_score FLOAT,
    -- 분석 워크플로우 상태: 순서 강제
    analysis_status VARCHAR(50) NOT NULL DEFAULT 'no_data'
        CHECK (analysis_status IN (
            'no_data',
            'data_ready',
            'baseline_set',
            'residual_done',
            'rul_done',
            'fully_analyzed'
        )),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ESP 일별 센서 데이터 테이블
-- PK: (well_id, date) - hypertable 요구사항 충족 + ON CONFLICT 업서트에 활용
CREATE TABLE IF NOT EXISTS esp_daily_data (
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    date DATE NOT NULL,

    -- 제어계통
    choke FLOAT,
    whp FLOAT,
    flt FLOAT,
    casing_pressure FLOAT,
    casing_pressure_2 FLOAT,

    -- 전기계통
    vfd_freq FLOAT,
    motor_volts FLOAT,
    motor_current FLOAT,
    motor_power FLOAT,
    motor_temp FLOAT,
    motor_vib FLOAT,
    current_leak FLOAT,

    -- 압력/온도계통
    pi FLOAT,
    ti FLOAT,
    pd FLOAT,
    static_pressure FLOAT,
    dd FLOAT,

    -- 수분 분석
    water_cut FLOAT,
    emulsion FLOAT,
    bsw FLOAT,

    -- 다상유량계 (MFM)
    mfm_pressure FLOAT,
    mfm_temp FLOAT,

    -- 생산량 (Null 다수 - 현장 테스트 시에만 기록)
    liquid_rate FLOAT,
    water_rate FLOAT,
    oil_haimo FLOAT,
    gas_meter FLOAT,
    gor FLOAT,

    -- 펌프 성능 지표
    dp_cross_pump FLOAT,
    liquid_pi FLOAT,
    oil_pi FLOAT,

    -- 기타
    comment TEXT,
    esp_type VARCHAR(50),

    PRIMARY KEY (well_id, date)
);

-- TimescaleDB hypertable 생성: date 컬럼 기준, 1개월 단위 청크
-- if_not_exists: 재실행 시 에러 방지
SELECT create_hypertable(
    'esp_daily_data',
    'date',
    chunk_time_interval => INTERVAL '1 month',
    if_not_exists => TRUE
);

-- 시계열 조회 최적화 인덱스 (well_id별, 날짜 내림차순)
CREATE INDEX IF NOT EXISTS idx_esp_daily_data_well_date
    ON esp_daily_data (well_id, date DESC);

-- 분석 세션 관리 (Step 1~4 진행 상태 추적)
CREATE TABLE IF NOT EXISTS analysis_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    parameters JSONB,
    celery_task_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 1 결과: PELT 변화점 + 베이스라인 구간
CREATE TABLE IF NOT EXISTS baseline_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    start_date DATE,
    end_date DATE,
    changepoints JSONB,  -- 변화점 날짜 배열
    is_manually_set BOOLEAN DEFAULT FALSE
);

-- Step 2 결과: Ridge 회귀 잔차 시계열
CREATE TABLE IF NOT EXISTS residual_data (
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    predicted FLOAT,
    actual FLOAT,
    residual FLOAT,
    residual_ma30 FLOAT,    -- 30일 이동평균 (추세 가시화)
    degradation_rate FLOAT, -- 일별 성능 저하율
    PRIMARY KEY (well_id, date)
);

-- Step 3 결과: Wiener 프로세스 RUL 예측
CREATE TABLE IF NOT EXISTS rul_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    rul_median INT,              -- 중앙값 (P50)
    rul_p10 INT,                 -- 낙관 예측 (P10)
    rul_p90 INT,                 -- 보수적 예측 (P90)
    expected_failure_date DATE,
    wiener_drift FLOAT,
    wiener_diffusion FLOAT
);

-- Step 4 결과: GMM + 마할라노비스 건강 점수
CREATE TABLE IF NOT EXISTS health_scores (
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    mahalanobis_distance FLOAT,
    health_score FLOAT,          -- 0(위험) ~ 100(정상)
    health_status VARCHAR(20)
        CHECK (health_status IN ('Normal', 'Degrading', 'Critical')),
    PRIMARY KEY (well_id, date)
);
