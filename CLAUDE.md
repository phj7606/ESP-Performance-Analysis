# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 프로젝트 개요

Offshore ESP(Electric Submersible Pump)의 성능 저하를 자동 감지하고 잔여 수명(RUL)을 예측하는 웹 기반 분석 플랫폼. 전체 요구사항은 `PRD.md` 참조.

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | Next.js 16 (App Router) + React 19.2 + TypeScript + Tailwind CSS 4.2 + shadcn/ui |
| 차트 | react-plotly.js 2.6 + plotly.js 3.1 (다중 축 시계열, 줌/팬, 어노테이션) |
| 상태 관리 | Zustand 5.0.11 (클라이언트) + TanStack Query 5.90 (서버 상태 + 폴링) |
| 백엔드 | FastAPI 0.135.x + SQLAlchemy 2.0.x (async) + asyncpg 0.31 |
| ML | ruptures 1.1.10, scikit-learn 1.8, lifelines 0.30.1 |
| 비동기 작업 | Celery 5.6 + Redis (redis-py 7.1) |
| DB | TimescaleDB 2.23 (PostgreSQL 16 확장) |
| 컨테이너 | Docker Compose |

---

## 개발 명령어

### 전체 환경 시작/종료

```bash
# 전체 스택 시작 (DB, Redis, Backend, Celery Worker, Frontend)
docker compose up -d

# 로그 확인
docker compose logs -f backend
docker compose logs -f celery_worker
docker compose logs -f frontend

# 전체 종료
docker compose down

# DB 볼륨 포함 완전 초기화
docker compose down -v
```

### 백엔드 (FastAPI)

```bash
# 개발 서버 실행 (컨테이너 밖 로컬 실행 시)
cd backend
uvicorn app.main:app --reload --port 8000

# 의존성 설치
pip install -r requirements.txt

# DB 마이그레이션
alembic upgrade head
alembic revision --autogenerate -m "설명"

# 테스트 실행
pytest
pytest tests/test_step1.py -v  # 특정 파일
pytest -k "test_pelt" -v        # 특정 테스트
```

### 프론트엔드 (Next.js)

```bash
# 개발 서버 실행
cd frontend
npm run dev

# 빌드
npm run build

# 린트
npm run lint

# 타입 체크
npx tsc --noEmit
```

### Celery Worker

```bash
# Worker 실행 (로컬)
cd backend
celery -A app.worker.celery_app worker --loglevel=info

# 작업 모니터링
celery -A app.worker.celery_app flower
```

---

## 아키텍처 구조

### 모노레포 디렉토리 구조 (계획)

```
ESP-Peroformance-Analysis/
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 앱 진입점
│   │   ├── api/                 # 라우터 (wells, upload, analysis, tasks, export)
│   │   ├── models/              # SQLAlchemy ORM 모델
│   │   ├── schemas/             # Pydantic 스키마
│   │   ├── services/            # 비즈니스 로직 (ML 파이프라인)
│   │   │   ├── step1_pelt.py    # ruptures PELT 변화점 감지
│   │   │   ├── step2_ridge.py   # Ridge 회귀 잔차 분석
│   │   │   ├── step3_rul.py     # Wiener 프로세스 RUL 예측
│   │   │   └── step4_health.py  # GMM + 마할라노비스 건강 점수
│   │   ├── worker/              # Celery 태스크 정의
│   │   └── db/                  # DB 연결, 초기화 SQL
│   ├── tests/
│   ├── alembic/                 # DB 마이그레이션
│   └── requirements.txt
└── frontend/
    ├── app/                     # Next.js App Router
    │   ├── page.tsx             # SCR-001: Well 대시보드
    │   ├── upload/page.tsx      # SCR-002: 파일 업로드
    │   └── wells/[id]/          # SCR-003~007: Well 상세 + 각 Step
    ├── components/
    │   ├── charts/              # Plotly.js 래퍼 컴포넌트
    │   └── ui/                  # shadcn/ui 컴포넌트
    ├── lib/
    │   ├── api.ts               # API 클라이언트 (fetch 래퍼)
    │   └── store.ts             # Zustand 스토어
    └── hooks/                   # TanStack Query 훅
```

### API 엔드포인트 구조

| 그룹 | 접두사 | 비고 |
|------|--------|------|
| Well 관리 | `GET /api/wells`, `GET /api/wells/{id}` | |
| 데이터 업로드 | `POST /api/upload` | Excel → TimescaleDB |
| 시계열 조회 | `GET /api/wells/{id}/data` | 날짜 범위 파라미터 |
| Step 1 | `POST/GET /api/wells/{id}/analysis/step1` | PELT, Celery 비동기 |
| Step 2 | `POST/GET /api/wells/{id}/analysis/step2` | Ridge 회귀 |
| Step 3 | `POST/GET /api/wells/{id}/analysis/step3` | RUL 예측 |
| Step 4 | `POST/GET /api/wells/{id}/analysis/step4` | 건강 점수 |
| 작업 상태 | `GET /api/tasks/{task_id}` | Celery 폴링용 |
| Export | `GET /api/wells/{id}/export` | CSV 다운로드 |

### ML 파이프라인 데이터 흐름

```
Excel 업로드 → TimescaleDB(esp_daily_data hypertable)
    → Step 1: ruptures PELT → 변화점 + 베이스라인 구간 (baseline_periods)
    → Step 2: Ridge(VFD Freq → Pi) → 잔차 시계열 (residual_data)
    → Step 3: Wiener Process Bootstrap(1000회) → RUL P10/P50/P90 (rul_predictions)
    → Step 4: GMM(n=2) + Mahalanobis → 건강 점수 0~100 (health_scores)
```

**워크플로우 순서 강제**: `no_data → data_ready → baseline_set → residual_done → rul_done → fully_analyzed`
각 Step은 이전 Step 완료 후에만 실행 가능.

### 비동기 작업 패턴

ML 분석(Step 1~4)은 모두 Celery로 비동기 처리:
1. `POST /api/wells/{id}/analysis/stepN` → Celery 태스크 enqueue → `task_id` 반환
2. 프론트엔드가 `GET /api/tasks/{task_id}` 폴링 (TanStack Query `refetchInterval`)
3. 완료 시 결과 조회 API 호출

---

## 데이터 관련 주의사항

- **Well 이름 정규화 필수**: 엑셀 원본에 `LF12-3A1H` 같은 오타 존재 → 업로드 시 `LF12-3-A1H`로 정규화
- **Null 데이터 처리**: Liquid, Water, Oil(Haimo), Gas(유량계) 컬럼은 null 다수 — 분석 로직에서 반드시 처리
- **Step 4 입력 피처 6개**: VFD Freq, Motor Current, Motor Temp, Motor Vib, Pi(흡입압), Pd(토출압)
- **Step 3 최소 데이터**: Wiener 모델 수렴을 위해 최소 90일 이상 잔차 데이터 필요

---

## MVP 제외 항목

BOCPD, LSTM, PDF Export, 다중 Well 동시 분석, 실시간 스트리밍, 인증(Auth)은 MVP 범위 밖. 구현하지 않음.
