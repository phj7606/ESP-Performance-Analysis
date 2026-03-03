# ESP-PAS 개발 가이드라인 (AI Agent용)

## 1. 프로젝트 개요

- **목적**: Offshore ESP(Electric Submersible Pump) 성능 저하 감지 및 잔여 수명(RUL) 예측 웹 플랫폼
- **단계**: 기획/문서 완료, 코드 미작성 상태 (현재 `backend/`, `frontend/` 디렉토리 미존재)
- **데이터**: `Production Data.xlsx` (Well: LF12-3-A1H, 기간: 2023-09-22 ~ 2026-02-28, 464일)
- **상세 스펙**: `docs/PRD.md`, `docs/ROADMAP.md` 참조 필수 — 코드 작성 전 반드시 해당 태스크 섹션 확인

---

## 2. 기술 스택 (버전 준수 필수)

| 레이어 | 기술 | 버전 | 비고 |
|--------|------|------|------|
| Frontend | Next.js + React + TypeScript | **16.1** / **19.2.4** / 5.x | Next.js 16.1 (2025-12-18 stable) |
| 스타일링 | Tailwind CSS + shadcn/ui | **4.2.x** | v4.2.0 (2026-02-19) |
| 차트 | react-plotly.js + plotly.js | **2.6.0** / **3.1.0** | react-plotly.js 미업데이트(3년) — plotly.js만 최신 유지 |
| 상태 관리 | Zustand + TanStack Query | **5.0.11** / **5.90.21** | |
| Backend | FastAPI + SQLAlchemy + asyncpg | **0.135.1** / **2.0.48** / **0.31.0** | SQLAlchemy 2.1.0b1은 아직 beta |
| Pydantic | pydantic + pydantic-settings | **2.12.5** / **2.13.1** | |
| ML | ruptures + scikit-learn + lifelines | **1.1.10** / **1.8.0** / **0.30.1** | |
| 비동기 | Celery + redis-py | **5.6.2** / **7.1.1** | Python ≥ 3.10 필수 (Celery 5.6) |
| DB | TimescaleDB (PostgreSQL **16**) | **2.23** | ⚠ PostgreSQL 15 지원 2026년 6월 종료 → pg16 사용 권장 |

---

## 3. 디렉토리 구조 및 파일 위치 규칙

### 필수 파일 위치 (벗어나면 안 됨)

```
backend/
├── app/
│   ├── main.py                    # FastAPI 진입점, CORS 설정
│   ├── core/
│   │   ├── config.py              # pydantic-settings 환경변수 (DATABASE_URL, REDIS_URL)
│   │   └── column_config.py       # COLUMN_MAPPING 딕셔너리 (Excel 컬럼 → DB 컬럼)
│   ├── api/
│   │   ├── wells.py               # GET /api/wells, GET /api/wells/{id}
│   │   ├── upload.py              # POST /api/upload
│   │   ├── analysis.py            # Step 1~4 분석 API
│   │   ├── tasks.py               # GET /api/tasks/{task_id}
│   │   └── export.py              # GET /api/wells/{id}/export
│   ├── models/
│   │   ├── well.py                # Well ORM 모델
│   │   ├── esp_data.py            # EspDailyData ORM 모델
│   │   └── analysis.py            # AnalysisSession, BaselinePeriod, ResidualData, RulPrediction, HealthScore
│   ├── schemas/
│   │   ├── well.py                # WellResponse, WellListResponse
│   │   ├── esp_data.py            # EspDataPoint, EspDataResponse
│   │   ├── upload.py              # UploadResponse
│   │   └── analysis.py            # AnalysisStatusResponse
│   ├── services/
│   │   ├── upload_service.py      # Excel 파싱 + Well 정규화
│   │   ├── step1_pelt.py          # ruptures PELT 변화점 감지
│   │   ├── step2_ridge.py         # Ridge 회귀 잔차 분석
│   │   ├── step3_rul.py           # Wiener 프로세스 RUL 예측
│   │   └── step4_health.py        # GMM + 마할라노비스 건강 점수
│   ├── worker/
│   │   ├── celery_app.py          # Celery 인스턴스 초기화
│   │   └── tasks.py               # Celery 태스크 정의 (task_run_step1~4)
│   └── db/
│       ├── database.py            # async_engine, AsyncSessionLocal, get_db
│       └── init.sql               # TimescaleDB 초기화 SQL
├── tests/
│   ├── test_upload.py
│   ├── test_step1.py
│   ├── test_step2.py
│   ├── test_step3.py
│   └── test_step4.py
└── alembic/                       # DB 마이그레이션

frontend/
├── app/
│   ├── layout.tsx                 # 공통 레이아웃 (Sidebar + WorkflowBar)
│   ├── page.tsx                   # SCR-001: Well 대시보드
│   ├── upload/page.tsx            # SCR-002: 파일 업로드
│   └── wells/[id]/
│       ├── page.tsx               # SCR-003: Well 상세 + 시계열 차트
│       ├── step1/page.tsx         # SCR-004: PELT 변화점
│       ├── step2/page.tsx         # SCR-005: Ridge 잔차
│       ├── step3/page.tsx         # SCR-006: RUL 예측
│       └── step4/page.tsx         # SCR-007: 건강 점수
├── components/
│   ├── charts/
│   │   ├── TimeSeriesChart.tsx    # 메인 시계열 차트 (Plotly.js)
│   │   ├── ColumnSelector.tsx     # 컬럼 선택 체크박스
│   │   ├── ResidualChart.tsx      # Step 2 잔차 차트
│   │   ├── RulChart.tsx           # Step 3 RUL 예측 차트
│   │   └── HealthScoreChart.tsx   # Step 4 건강 점수 차트
│   ├── layout/
│   │   ├── Sidebar.tsx            # 사이드바 (Well 목록)
│   │   └── WorkflowBar.tsx        # Step 1~4 진행 표시줄
│   └── ui/                        # shadcn/ui 컴포넌트
├── lib/
│   ├── api.ts                     # API 클라이언트 (fetch 래퍼)
│   └── store.ts                   # Zustand 스토어
└── hooks/
    ├── useWells.ts
    ├── useWell.ts
    ├── useWellData.ts
    ├── useTaskPolling.ts
    └── useStep1.ts ~ useStep4.ts
```

### 새 파일 생성 규칙

- **API 라우터 추가** → `backend/app/api/`에만 생성, `backend/app/main.py`에 `include_router` 추가 필수
- **Celery 태스크 추가** → `backend/app/worker/tasks.py`에만 추가 (파일 분산 금지)
- **새 React 컴포넌트** → 차트: `frontend/components/charts/`, 레이아웃: `frontend/components/layout/`, UI: `frontend/components/ui/`
- **새 TanStack Query 훅** → `frontend/hooks/`에만 생성

---

## 4. 백엔드 구현 규칙

### FastAPI

- 모든 라우터는 `prefix="/api"` 아래 등록
- DB 의존성은 `get_db()` 함수만 사용 (`backend/app/db/database.py`)
- 환경변수는 `backend/app/core/config.py`의 `Settings` 클래스에서만 참조 (직접 `os.environ` 사용 금지)
- `analysis_status` 전이 검증은 서비스 레이어가 아닌 **Celery 태스크** 내에서 수행
- HTTP 에러 반환 규칙:
  - 순서 잠금 위반 → `HTTP 422 Unprocessable Entity`
  - 데이터 부족 → `HTTP 422 + 상세 메시지`
  - 파일 형식 오류 → `HTTP 400`

### Celery 태스크

- 태스크 시작 시: `analysis_sessions` 상태를 `running`으로 업데이트
- 태스크 완료 시: 결과 테이블 upsert + `wells.analysis_status` 업데이트
- 태스크 실패 시: `analysis_sessions.error_message`에 에러 저장 후 예외 재발생
- 태스크명 패턴: `task_run_step{N}(well_id, **params)`

### ML 서비스 함수 시그니처

```python
# Step 1
run_pelt(well_id: str, penalty: float = 3.0, columns: list[str] = None) -> dict

# Step 2
run_ridge(well_id: str, alpha: float = 1.0) -> dict

# Step 3
run_rul(well_id: str, threshold: float = -2.0, n_bootstrap: int = 1000) -> dict

# Step 4
run_health_score(well_id: str, n_components: int = 2) -> dict
```

### SQLAlchemy

- 비동기 엔진만 사용 (`asyncpg`)
- bulk insert: `execute(insert(...))` 배치 방식 사용 (row-by-row 금지)
- Well 중복 처리: `INSERT ... ON CONFLICT (name) DO UPDATE SET updated_at = now()`

---

## 5. 프론트엔드 구현 규칙

### Next.js / React

- **[CRITICAL]** `react-plotly.js` 차트 컴포넌트는 반드시 `next/dynamic`으로 감싸고 `ssr: false` 설정
  ```typescript
  // 모든 차트 컴포넌트에 적용
  const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });
  ```
- 서버 컴포넌트에서 데이터 패칭 금지 — 모든 API 호출은 클라이언트 컴포넌트 + TanStack Query 훅으로만 처리
- Next.js 15 App Router 사용 (Pages Router 사용 금지)

### 상태 관리

- 클라이언트 UI 상태: `Zustand` (`frontend/lib/store.ts`)
- 서버 데이터 상태: `TanStack Query` (`frontend/hooks/`)
- 두 레이어의 상태를 혼합하지 않음 (TanStack Query 데이터를 Zustand에 저장 금지)

### TanStack Query 훅 규칙

- `useWells`: `staleTime: 60000` (60초)
- `useTaskPolling`: `refetchInterval: 2000`, `SUCCESS`/`FAILURE` 응답 시 즉시 폴링 중단
- `useWells` 대시보드: `refetchInterval: 30000` (30초 자동 갱신)
- 분석 실행(POST)은 `useMutation` 사용

### API 클라이언트

- `frontend/lib/api.ts`의 `apiFetch()` 래퍼만 사용 (직접 `fetch()` 호출 금지)
- HTTP 4xx/5xx는 `ApiError` 클래스로 변환하여 throw
- 환경변수 `NEXT_PUBLIC_API_URL` 기반으로 베이스 URL 결정

### UI 에러 처리

- API 오류는 `shadcn/ui Toaster`로 표시
- 로딩 중: Skeleton 컴포넌트 사용
- Celery 태스크 실패: 에러 메시지 + "재시도" 버튼 표시

---

## 6. ML 파이프라인 순서 잠금 규칙 (CRITICAL)

### analysis_status 상태 전이 (이 순서만 허용)

```
no_data → data_ready → baseline_set → residual_done → rul_done → fully_analyzed
```

| 상태 | 의미 | 다음 허용 Step |
|------|------|---------------|
| `no_data` | 데이터 미업로드 | 업로드만 가능 |
| `data_ready` | 데이터 업로드 완료 | Step 1만 실행 가능 |
| `baseline_set` | Step 1 완료 | Step 2만 실행 가능 |
| `residual_done` | Step 2 완료 | Step 3만 실행 가능 |
| `rul_done` | Step 3 완료 | Step 4만 실행 가능 |
| `fully_analyzed` | Step 4 완료 | CSV Export 가능 |

### 상태 검증 구현 위치

- **Backend**: 각 Celery 태스크 내에서 `analysis_status` 검증 후 미충족 시 `ValueError` 발생
- **Frontend**: `WorkflowBar` 컴포넌트에서 이전 Step 미완료 시 버튼 비활성화
- 상태 역행 불가 — `fully_analyzed` Well을 재분석하려면 상태 리셋 API 필요 (MVP 미구현)

---

## 7. 데이터 처리 규칙

### Well 이름 정규화 (업로드 시 반드시 적용)

- 함수 위치: `backend/app/services/upload_service.py`의 `normalize_well_name()`
- 규칙: 숫자와 영문 사이에 하이픈 삽입 (예: `LF12-3A1H` → `LF12-3-A1H`)
- 정규화 내역을 `UploadResponse.warnings` 필드에 포함하여 반환

### Null 컬럼 처리 전략

| 컬럼 | 처리 방법 |
|------|-----------|
| `liquid_rate`, `water_rate`, `oil_haimo`, `gas_meter` | null 다수 — DB에 NULL 저장, 분석에서 제외 |
| `vfd_freq`, `motor_current`, `motor_temp`, `motor_vib`, `pi`, `pd` | Step 4 입력 피처 — null 있는 날짜는 Step 4 학습에서 제외 |
| `vfd_freq`, `pi` | Step 1/2 기준 컬럼 — null 행 제거 후 분석 |

### ML 최소 데이터 검증

- **Step 2**: 베이스라인 구간 < 30일 → `ValueError` 발생
- **Step 3**: 잔차 데이터 < 90일 → `ValueError: Wiener 모델 수렴 불가, 최소 90일 필요`
- **Step 4**: `n_init=10`, `random_state=42` 설정으로 재현성 확보; 베이스라인 부족 시 `n_components=1`로 폴백

### TimescaleDB 규칙

- `esp_daily_data` 테이블은 반드시 hypertable로 생성 (`SELECT create_hypertable('esp_daily_data', 'date')`)
- 날짜 범위 쿼리: `WHERE date BETWEEN :start AND :end` 인덱스 활용
- 시계열 조회 최대 행 수: **3000행** 제한 (차트 렌더링 성능)

### Excel 컬럼 매핑

- 컬럼 매핑 딕셔너리는 `backend/app/core/column_config.py`의 `COLUMN_MAPPING`에만 정의
- 업로드 필수 컬럼: `date`, `vfd_freq`, `pi`, `motor_current` — 누락 시 `HTTP 400` 반환

---

## 8. 다중 파일 연동 규칙

### API 라우터 추가 시

동시 수정 필요 파일:
1. `backend/app/api/{router_file}.py` — 라우터 구현
2. `backend/app/main.py` — `include_router()` 추가
3. `backend/app/schemas/` — 해당 Pydantic 스키마 추가

### 새 ML Step 추가 시

동시 수정 필요 파일:
1. `backend/app/services/step{N}_{name}.py` — 서비스 함수
2. `backend/app/worker/tasks.py` — Celery 태스크
3. `backend/app/api/analysis.py` — POST/GET 라우터
4. `frontend/lib/api.ts` — 클라이언트 함수 추가
5. `frontend/hooks/useStep{N}.ts` — TanStack Query 훅
6. `frontend/app/wells/[id]/step{N}/page.tsx` — UI 페이지

### analysis_status 상태값 변경 시

동시 수정 필요 파일:
1. `backend/app/models/well.py` — Python Enum 수정
2. `backend/app/db/init.sql` — CHECK 제약 수정
3. `frontend/components/layout/WorkflowBar.tsx` — 상태 표시 로직
4. `frontend/app/wells/[id]/page.tsx` — 워크플로우 패널 상태

### Docker Compose 환경변수 추가 시

동시 수정 필요 파일:
1. `docker-compose.yml` — 서비스 환경변수 섹션
2. `.env.example` — 예시 값 추가
3. `backend/app/core/config.py` — Settings 클래스 필드 추가

---

## 9. 비동기 작업 패턴

### ML 분석 요청 흐름

```
1. POST /api/wells/{id}/analysis/step{N}  → Celery 태스크 enqueue → {task_id} 반환
2. 프론트엔드: useTaskPolling(taskId) → GET /api/tasks/{task_id} 2초마다 폴링
3. 상태 'SUCCESS' → GET /api/wells/{id}/analysis/step{N} 로 결과 조회
4. 상태 'FAILURE' → error_message 표시 + 재시도 버튼
```

### Celery 설정 규칙

- `task_serializer='json'`, `result_serializer='json'`, `task_track_started=True`
- Redis 영속화: `--appendonly yes` (docker-compose.yml command 옵션으로 전달)
- `celery_task_id`를 `analysis_sessions` 테이블에 저장 (재시작 시 상태 복구용)

---

## 10. Step별 핵심 파라미터 (UI에서 조정 가능해야 함)

| Step | 파라미터 | 기본값 | 범위 |
|------|---------|--------|------|
| Step 1 (PELT) | `penalty` | 3.0 | 0.5 ~ 10.0 (낮을수록 변화점 많이 감지) |
| Step 2 (Ridge) | `alpha` | 1.0 | Ridge 정규화 강도 |
| Step 3 (Wiener) | `threshold` | -2.0 | -5.0 ~ 0.0 (고장 판정 잔차 임계값) |
| Step 4 (GMM) | `n_components` | 2 | GMM 컴포넌트 수 |

---

## 11. 성공 지표 및 검증 기준

| Step | 검증 기준 |
|------|----------|
| 업로드 | `esp_daily_data` 464건 적재, Well 이름 `LF12-3-A1H`로 정규화 |
| Step 2 | R² ≥ 0.80 (Production Data.xlsx 기준) |
| Step 3 | P90 - P10 < 180일 (신뢰 구간 < 6개월) |
| Step 4 | 건강 점수 0~100 범위, 상태 분류 경계값 정확 (70/40) |

---

## 12. 금지 사항

### MVP 범위 이탈 금지

- **구현하지 말 것**: 인증(Auth), 다중 Well 동시 분석, 실시간 스트리밍, PDF Export, BOCPD, LSTM, 이메일/SMS 알람, 모바일 반응형
- 추가 기능은 구현하지 말고 `docs/BUGS.md`에 기록

### 코드 품질 금지사항

- `os.environ` 직접 참조 금지 → `config.py`의 `Settings` 사용
- `react-plotly.js` SSR 없이 import 금지 → `next/dynamic + ssr: false` 필수
- row-by-row DB insert 금지 → SQLAlchemy bulk insert 사용
- `analysis_status` 순서 검증 없이 Step 실행 금지
- `COLUMN_MAPPING` 하드코딩 금지 → `column_config.py` 참조
- 직접 `fetch()` 호출 금지 → `apiFetch()` 래퍼 사용
- Plotly 차트 데이터를 서버 컴포넌트에서 패칭 금지

### 아키텍처 위반 금지

- 서비스 레이어 (`services/`)에서 직접 DB 커넥션 생성 금지 → `get_db()` 의존성 주입 사용
- Celery 태스크에서 동기 SQLAlchemy 사용 금지 → 비동기 세션 사용
- `frontend/lib/api.ts` 외부에서 API URL 하드코딩 금지
