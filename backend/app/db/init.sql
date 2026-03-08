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
    -- no_data → data_ready → diagnosis_done → health_done → fully_analyzed
    analysis_status VARCHAR(50) NOT NULL DEFAULT 'no_data'
        CHECK (analysis_status IN (
            'no_data',
            'data_ready',
            'diagnosis_done',
            'health_done',
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

-- Step 2 결과: CV 기반 자동 학습 구간 (GMM 학습에 사용)
-- is_manually_set=False: CV 자동 탐지, True: 수동 지정
CREATE TABLE IF NOT EXISTS baseline_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    start_date DATE,   -- 학습 구간 시작
    end_date DATE,     -- 학습 구간 종료
    training_start DATE,  -- 호환성 유지 (start_date와 동일값)
    changepoints JSONB,   -- CV 메타데이터 (features_used 등)
    is_manually_set BOOLEAN DEFAULT FALSE
);

-- Step 1 결과: 4개 무차원 성능 지수 시계열 (전체 기간)
-- residual* 컬럼은 하위 호환성 유지 (NULL로 저장)
CREATE TABLE IF NOT EXISTS residual_data (
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    -- 4개 무차원 성능 지수 (일 단위)
    cp FLOAT,           -- 전력 지수: motor_power / (sg × f³)
    psi FLOAT,          -- 헤드 지수: (pd-pi) / (sg × f²)
    v_std FLOAT,        -- 진동 지수: motor_vib / f²
    t_eff FLOAT,        -- 냉각 지수: (motor_temp-ti) / motor_power
    eta_proxy FLOAT,         -- 효율 Proxy: (pd-pi) / motor_power [psi/kW]
    pump_load_index FLOAT,   -- 펌프 부하 지수: power / (ΔP × liquid_rate)
    -- 30일 이동 평균
    cp_ma30 FLOAT,
    psi_ma30 FLOAT,
    v_std_ma30 FLOAT,
    t_eff_ma30 FLOAT,
    eta_proxy_ma30 FLOAT,
    pump_load_index_ma30 FLOAT,
    -- 하위 호환용 NULL 컬럼
    residual FLOAT,
    residual_ma30 FLOAT,
    predicted FLOAT,
    actual FLOAT,
    degradation_rate FLOAT,
    PRIMARY KEY (well_id, date)
);

-- Step 3 결과: Prophet 외삽 RUL 예측 (건강 점수 40점 도달 시점)
CREATE TABLE IF NOT EXISTS rul_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    rul_median INT,              -- 중앙값 P50 (일)
    rul_p10 INT,                 -- 보수적 P10 (일) — 빠른 도달
    rul_p90 INT,                 -- 낙관적 P90 (일) — 늦은 도달
    expected_failure_date DATE   -- P50 기준 예상 만료일
);

-- Step 2 결과: GMM + 마할라노비스 건강 점수 (전체 기간 일별)
-- 학습 구간: baseline_periods 참조, GMM 정상 컴포넌트 기준 마할라노비스 거리
CREATE TABLE IF NOT EXISTS health_scores (
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    mahalanobis_distance FLOAT,
    health_score FLOAT,          -- 0(위험) ~ 100(정상): 100 × exp(-k × distance)
    health_status VARCHAR(20)
        CHECK (health_status IN ('Normal', 'Degrading', 'Critical')),
    -- 피처 기여도: 점수 하락 원인 비율 (합 = 1.0, hover 인터랙션용)
    contribution_eta   FLOAT,
    contribution_v_std FLOAT,
    contribution_t_eff FLOAT,
    PRIMARY KEY (well_id, date)
);

-- Step 2-B 결과: Trend-Residual Health Scoring (전체 기간 일별)
-- MA30 기준선 + 잔차 σ 기반 이탈 감점 + 기울기 감점 방식 (GMM과 독립)
CREATE TABLE IF NOT EXISTS trend_residual_scores (
    well_id UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    health_score  FLOAT,         -- 종합 건강 점수 (10~100, 가중 평균)
    health_status VARCHAR(20)
        CHECK (health_status IN ('Normal', 'Degrading', 'Critical')),
    score_eta     FLOAT,         -- η_proxy 개별 점수 (Radar 차트: 효율 지수)
    score_v_std   FLOAT,         -- v_std 개별 점수 (Radar 차트: 진동 지수)
    score_t_eff   FLOAT,         -- t_eff 개별 점수 (Radar 차트: 냉각 지수)
    PRIMARY KEY (well_id, date)
);

-- Step 3 결과: 3-Pillar 독립 고장 모드 알람
-- P1: 유압 성능 (ψ_ma30 Mann-Kendall 하락 추세)
-- P2: 기계 진동 (v_std_ma30 Mann-Kendall 상승 추세)
-- P3: 절연 누설 (current_leak 절대값 + 3일 지속 조건)
CREATE TABLE IF NOT EXISTS pillar_results (
    id            BIGSERIAL PRIMARY KEY,
    well_id       UUID NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
    computed_at   TIMESTAMPTZ DEFAULT NOW(),
    -- Pillar 1: Hydraulic
    p1_status       VARCHAR(20),   -- normal / warning / critical / unknown
    p1_tau          FLOAT,         -- Mann-Kendall tau (하락: 음수)
    p1_pvalue       FLOAT,         -- Mann-Kendall p-value
    p1_current_val  FLOAT,         -- 최근 ψ_ma30 값
    p1_baseline_val FLOAT,         -- 베이스라인 평균
    p1_threshold    FLOAT,         -- CRITICAL 임계치 (baseline × 0.80)
    -- Pillar 2: Mechanical
    p2_status       VARCHAR(20),
    p2_tau          FLOAT,         -- Mann-Kendall tau (상승: 양수)
    p2_pvalue       FLOAT,
    p2_current_val  FLOAT,         -- 최근 v_std_ma30 값
    p2_baseline_val FLOAT,
    p2_threshold    FLOAT,         -- CRITICAL 임계치 (baseline × 1.50)
    -- Pillar 3: Electrical
    p3_status         VARCHAR(20), -- normal / warning / critical / unknown
    p3_current_val    FLOAT,       -- 최근 이동 중앙값 (μA)
    p3_days_exceeded  INTEGER,     -- 임계치 초과 연속 일수
    p3_data_available BOOLEAN
);
