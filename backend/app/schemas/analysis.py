"""
Step 1~3 분석 Pydantic 스키마 정의.

각 Step의 요청/응답 형식을 명시적으로 정의하여
API 계약 강제 및 FastAPI Swagger 자동 문서화를 지원.
"""
from typing import Optional
from pydantic import BaseModel


# ============================================================
# 공통 스키마
# ============================================================

class TaskStatusResponse(BaseModel):
    """Celery 비동기 태스크 상태 응답"""
    task_id: str
    # PENDING: 대기 중, STARTED: 실행 중, SUCCESS: 완료, FAILURE: 실패
    status: str
    result: Optional[dict] = None
    error: Optional[str] = None


# ============================================================
# Step 1 스키마: 성능 진단 (4개 무차원 지수)
# ============================================================

class Step1RunRequest(BaseModel):
    """Step 1 분석 실행 요청 — 유체 비중 파라미터"""
    # SG_liquid = water_cut × sg_water + (1 - water_cut) × sg_oil
    sg_oil: float = 0.85    # 원유 비중 기본값 (일반 원유: 0.80~0.90)
    sg_water: float = 1.03  # 해수 비중 기본값 (해수: 약 1.025)


class Step1IndexPoint(BaseModel):
    """무차원 성능 지수 시계열 데이터 한 점 (날짜별)"""
    date: str
    cp: Optional[float] = None           # 전력 지수: motor_power / (sg × f³)
    psi: Optional[float] = None          # 헤드 지수: (pd-pi) / (sg × f²)
    v_std: Optional[float] = None        # 진동 지수: motor_vib / f²
    t_eff: Optional[float] = None        # 냉각 지수: (motor_temp-ti) / motor_power
    eta_proxy: Optional[float] = None          # 효율 Proxy: ψ/Cp = (pd-pi)×f / motor_power [psi·Hz/kW]
    pump_load_index: Optional[float] = None    # 펌프 부하 지수: power / (ΔP × liquid_rate)
    cp_ma30: Optional[float] = None
    psi_ma30: Optional[float] = None
    v_std_ma30: Optional[float] = None
    t_eff_ma30: Optional[float] = None
    eta_proxy_ma30: Optional[float] = None
    pump_load_index_ma30: Optional[float] = None
    # Step 2 완료 후 학습 구간 표시 (Step 1 직후엔 False)
    is_training: bool = False


class Step1ResultResponse(BaseModel):
    """Step 1 분석 완료 결과 — 4개 무차원 성능 지수 전체 기간 시계열"""
    well_id: str
    sg_oil: float
    sg_water: float
    data_start: Optional[str] = None
    data_end: Optional[str] = None
    # WHP 보정 회귀 결과 (ψ_corrected = (ΔP - C×WHP) / (sg×f²))
    psi_whp_coeff:     Optional[float] = None  # 회귀 기울기 C
    psi_whp_intercept: Optional[float] = None  # 회귀 절편
    psi_whp_r2:        Optional[float] = None  # 결정계수 R²
    psi_whp_n_samples: Optional[int]   = None  # 회귀에 사용된 유효 데이터 수
    indices: list[Step1IndexPoint]


# ============================================================
# Step 2 스키마: 건강 점수 (CV 탐지 + GMM + Mahalanobis)
# ============================================================

class Step2HealthPoint(BaseModel):
    """건강 점수 시계열 데이터 한 점"""
    date: str
    mahalanobis_distance: Optional[float] = None
    health_score: Optional[float] = None      # 0(위험) ~ 100(정상)
    health_status: Optional[str] = None       # Normal / Degrading / Critical
    is_training: bool                         # True: CV 학습 구간
    # 피처 기여도 (점수 하락 원인 비율, 합 = 1.0)
    contribution_eta:   Optional[float] = None  # Efficiency (η_proxy) 기여도 (0~1)
    contribution_v_std: Optional[float] = None  # Vibration (v_std) 기여도 (0~1)
    contribution_t_eff: Optional[float] = None  # Cooling (t_eff) 기여도 (0~1)


class Step2ResultResponse(BaseModel):
    """Step 2 분석 완료 결과 — 건강 점수 시계열 + 학습 구간 정보"""
    well_id: str
    training_start: Optional[str] = None      # CV 자동 탐지 학습 구간 시작
    training_end: Optional[str] = None        # CV 자동 탐지 학습 구간 종료
    features_used: list[str]                  # GMM 학습에 사용된 지수 목록
    k_factor: Optional[float] = None          # 건강 점수 정규화 계수
    scores: list[Step2HealthPoint]


# ============================================================
# Step 2-B 스키마: Trend-Residual Health Scoring
# ============================================================

class Step2bScorePoint(BaseModel):
    """Trend-Residual 건강 점수 시계열 데이터 한 점"""
    date: str
    health_score: Optional[float] = None      # 10(하한) ~ 100(정상)
    health_status: Optional[str] = None       # Normal / Degrading / Critical
    # 피처별 개별 점수 (Radar 차트: 고장 원인 판별)
    score_eta:   Optional[float] = None  # η_proxy 점수 (효율 지수)
    score_v_std: Optional[float] = None  # v_std 점수 (진동 지수)
    score_t_eff: Optional[float] = None  # t_eff 점수 (냉각 지수)


class Step2bResultResponse(BaseModel):
    """Step 2-B 분석 완료 결과 — Trend-Residual 건강 점수 시계열"""
    well_id: str
    rows_written: int
    scores: list[Step2bScorePoint]


# ============================================================
# Step 3 스키마: 3-Pillar 독립 고장 모드 알람
# ============================================================

class Step3RunRequest(BaseModel):
    """Step 3 분석 실행 요청 — 파라미터 없음 (3-Pillar 알람은 고정 임계치 사용)"""
    pass


class PillarAlarm(BaseModel):
    """Pillar 1/2 공통 알람 응답 (Mann-Kendall 추세 기반)"""
    status: Optional[str] = None          # normal / warning / critical / unknown
    tau: Optional[float] = None           # Mann-Kendall tau (P1: 음수=하락, P2: 양수=상승)
    pvalue: Optional[float] = None        # Mann-Kendall p-value
    current_val: Optional[float] = None   # 최근 지표 값
    baseline_val: Optional[float] = None  # 베이스라인 평균
    threshold: Optional[float] = None     # CRITICAL 임계치 절대값


class Pillar3Alarm(BaseModel):
    """Pillar 3 알람 응답 (current_leak 절대값 + 3일 지속 조건)"""
    status: Optional[str] = None          # normal / warning / critical / unknown
    current_val: Optional[float] = None   # 최근 이동 중앙값 (μA)
    days_exceeded: Optional[int] = None   # 임계치 초과 연속 일수
    data_available: bool = False


class Step3PillarResponse(BaseModel):
    """Step 3 분석 완료 결과 — 3-Pillar 독립 고장 모드 알람"""
    well_id: str
    computed_at: Optional[str] = None
    pillar1: PillarAlarm   # Hydraulic: ψ 하락 추세
    pillar2: PillarAlarm   # Mechanical: v_std 상승 추세
    pillar3: Pillar3Alarm  # Electrical: current_leak 절대값


# 하위 호환성 유지: 기존 타입 별칭 (rul_predictions 테이블 여전히 존재)
Step3ResultResponse = Step3PillarResponse
