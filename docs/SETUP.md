# 개발 환경 설정 가이드

ESP Performance Analysis System(ESP-PAS) 로컬 개발 환경 구성 방법입니다.

---

## 사전 요구사항

| 도구 | 최소 버전 | 확인 명령 |
|------|----------|----------|
| Docker Desktop | 4.x | `docker --version` |
| Docker Compose | 2.x | `docker compose version` |
| Node.js (선택, 로컬 실행 시) | 20.x | `node --version` |
| Python (선택, 로컬 실행 시) | 3.11+ | `python --version` |

---

## 빠른 시작 (Docker Compose)

```bash
# 1. 저장소 클론
git clone <repo-url>
cd ESP-Performance-Analysis

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 필요한 값 수정 (기본값으로 바로 실행 가능)

# 3. 전체 스택 시작 (5개 서비스: timescaledb, redis, backend, celery_worker, frontend)
docker compose up -d

# 4. 서비스 상태 확인
docker compose ps

# 5. 백엔드 헬스체크
curl http://localhost:8000/health
# 기대 응답: {"status":"ok"}

# 6. 프론트엔드 접속
open http://localhost:3000
```

---

## 데이터 업로드

```bash
# Excel 파일 업로드 (multipart form)
curl -X POST http://localhost:8000/api/upload \
  -F "file=@Production Data.xlsx"

# 기대 응답 예시
# {
#   "wells": [{"well_name":"LF12-3-A1H","records_inserted":464,...}],
#   "total_wells": 1,
#   "total_records": 464
# }
```

또는 프론트엔드 업로드 페이지(`http://localhost:3000/upload`)에서 드래그 앤 드롭으로 업로드합니다.

---

## 분석 워크플로우

업로드 후 Well 상세 페이지에서 순서대로 분석을 실행합니다.

```
데이터 업로드 → Step 1 실행 → Step 2 실행 → Step 3 실행
```

각 Step은 이전 Step 완료 후에만 실행 가능합니다 (`HTTP 422` 반환).

---

## 로그 확인

```bash
# 백엔드 로그
docker compose logs -f backend

# Celery Worker 로그 (ML 분석 태스크 실행 상태)
docker compose logs -f celery_worker

# 프론트엔드 로그
docker compose logs -f frontend

# 전체 서비스 로그
docker compose logs -f
```

---

## DB 직접 접속

```bash
# TimescaleDB 쉘 접속
docker compose exec timescaledb psql -U espuser -d espdb

# 주요 테이블 확인
\dt
SELECT count(*) FROM esp_daily_data;
SELECT name, analysis_status FROM wells;
```

---

## 환경 변수 설명

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `POSTGRES_USER` | `espuser` | TimescaleDB 사용자 |
| `POSTGRES_PASSWORD` | `esppass` | TimescaleDB 비밀번호 |
| `POSTGRES_DB` | `espdb` | 데이터베이스 이름 |
| `DATABASE_URL` | `postgresql+asyncpg://...` | SQLAlchemy 연결 URL |
| `REDIS_URL` | `redis://redis:6379/0` | Celery 브로커 URL |
| `MAX_UPLOAD_SIZE` | `52428800` (50MB) | 업로드 파일 최대 크기 (bytes) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS 허용 오리진 (콤마 구분) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | 프론트엔드 API 기본 URL |

---

## DB 마이그레이션

```bash
# 최신 마이그레이션 적용
docker compose exec backend alembic upgrade head

# 새 마이그레이션 생성
docker compose exec backend alembic revision --autogenerate -m "설명"

# 마이그레이션 기록 확인
docker compose exec backend alembic history
```

---

## 로컬 개발 (컨테이너 없이)

### 백엔드

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# .env 파일 환경 변수 로드 후 실행
export DATABASE_URL=postgresql+asyncpg://espuser:esppass@localhost:5432/espdb
export REDIS_URL=redis://localhost:6379/0
uvicorn app.main:app --reload --port 8000
```

### Celery Worker

```bash
cd backend
celery -A app.worker.celery_app worker --loglevel=info
```

### 프론트엔드

```bash
cd frontend
npm install
npm run dev
# http://localhost:3000 접속
```

---

## 전체 초기화

```bash
# 컨테이너 + 볼륨(DB 데이터) 완전 삭제
docker compose down -v

# 재시작
docker compose up -d
```

---

## 자주 발생하는 오류

### `relation "esp_daily_data" does not exist`
- **원인**: TimescaleDB 초기화 SQL이 실행되지 않은 경우
- **해결**: `docker compose down -v && docker compose up -d`로 볼륨 포함 초기화

### `celery_worker` 시작 실패 (`STARTUP_ERROR`)
- **원인**: Redis 연결 전에 Worker가 시작되는 타이밍 문제
- **해결**: `docker compose restart celery_worker`

### 프론트엔드 `ECONNREFUSED` (백엔드 연결 실패)
- **원인**: `BACKEND_INTERNAL_URL` 환경변수 미설정 또는 백엔드 미시작
- **해결**: `docker compose ps`로 backend 서비스 상태 확인 후 재시작

### Apple Silicon (M1/M2/M3) 빌드 오류
- **원인**: arm64 APT 미러 404
- **해결**: `backend/Dockerfile`의 `apt-get update` 명령에 `|| true` 이미 적용됨. 오류 무시하고 진행됨.

### `alembic.exc.CommandError: Target database is not up to date`
- **원인**: `esp_daily_data` 테이블이 `init.sql`로 생성되어 Alembic 버전 불일치
- **해결**: `alembic stamp head`로 현재 상태를 최신으로 표시

---

## CSV Export

Well 상세 페이지 헤더 우측의 **CSV Export** 버튼 클릭 시:
- `esp_daily_data`(원본) + `residual_data`(Step 1 지수) + `health_scores`(Step 2 건강점수)를 JOIN한 통합 CSV 다운로드
- 분석 미완료 컬럼은 빈 값으로 포함
- 파일명: `{well_name}_export.csv`

```bash
# API 직접 호출
curl -o export.csv "http://localhost:8000/api/wells/{WELL_ID}/export"
```
