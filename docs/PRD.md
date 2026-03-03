# ESP-PAS (ESP Performance Analysis System) PRD

> **버전**: 1.1.0 | **작성일**: 2026-03-03 | **상태**: MVP 기준 문서
> **데이터 기준**: Production Data.xlsx (LF12-3-A1H, 2023-09-22 ~ 2026-02-28)

---

## 1. 제품 개요

**한 줄 설명**: Offshore ESP(Electric Submersible Pump)의 성능 저하를 자동 감지하고 잔여 수명(RUL)을 예측하는 웹 기반 분석 플랫폼

**핵심 문제**

| 문제 | 현재 방식 | ESP-PAS 해결책 |
|------|-----------|----------------|
| 성능 저하 감지 지연 | 주기적 수동 검토 | 자동 변화점 감지 (ruptures PELT) |
| 성능 기준선 모호 | 엔지니어 경험 의존 | 통계적 베이스라인 자동 수립 |
| RUL 예측 부재 | 직관적 판단 | Wiener 프로세스 Bootstrap 예측 |
| 건강 점수 없음 | 단순 알람 임계값 | GMM 기반 다변량 건강 점수 |

**대상 사용자**

- 1차: ESP 담당 프로덕션 엔지니어 (현장 모니터링 및 분석)
- 2차: 생산 최적화 팀 (의사결정 지원)
- 3차: 관리자 (대시보드 조회)

**MVP 범위**

| 포함 | 제외 |
|------|------|
| 단일 Well 분석 | 다중 Well 동시 분석 |
| 4단계 ML 파이프라인 | 실시간 데이터 스트리밍 |
| 시계열 시각화 | 자동 알람 발송 |
| 건강 점수 대시보드 | PDF Export |
| CSV Export | BOCPD, LSTM |

---

## 2. 기술 스택

| 레이어 | 기술 | 선택 이유 |
|--------|------|-----------|
| **프론트엔드** | Next.js 16 + React 19.2 | App Router SSR, Server Components |
| **언어** | TypeScript 5.x | 타입 안전성 |
| **스타일링** | Tailwind CSS 4.2 | 유틸리티 클래스 기반 빠른 개발 |
| **UI 컴포넌트** | shadcn/ui | Radix UI 기반, 커스터마이징 용이 |
| **차트** | Plotly.js 3.1 (react-plotly.js 2.6) | 다중 축 시계열, 줌/팬, 어노테이션 |
| **상태 관리** | Zustand 5.0.11 | 경량, 보일러플레이트 최소 |
| **서버 상태** | TanStack Query 5.90 | 캐싱, 폴링, 로딩 상태 관리 |
| **백엔드** | FastAPI 0.135.x | 비동기, 자동 OpenAPI 문서 |
| **ML 파이프라인** | ruptures 1.1.10, scikit-learn 1.8, lifelines 0.30.1 | 변화점 감지, 회귀, 생존 분석 |
| **비동기 작업** | Celery 5.6 + redis-py 7.1 | ML 장시간 작업 백그라운드 처리 |
| **데이터베이스** | TimescaleDB 2.23 (PostgreSQL 16) | 시계열 특화, hypertable 압축 |
| **ORM** | SQLAlchemy 2.0.48 + asyncpg 0.31 | 비동기 쿼리, 마이그레이션 |
| **컨테이너** | Docker Compose | 로컬 개발 환경 일관성 |
| **데이터 처리** | pandas, openpyxl | Excel 파싱, 전처리 |

---

## 3. 핵심 기능

| ID | 기능명 | 설명 | 우선순위 |
|----|--------|------|----------|
| F-001 | Excel 데이터 업로드 | Production Data.xlsx 업로드, Well 정규화, TimescaleDB 적재 | P0 |
| F-002 | Well 대시보드 | 등록 Well 현황 카드 그리드 (건강 점수, 상태 배지, 최근 측정값) | P0 |
| F-003 | 시계열 성능 차트 | 다중 파라미터 시계열, 변화점 어노테이션, 날짜 범위 선택 | P0 |
| F-004 | Step 1 - 베이스라인 분할 | PELT 알고리즘 변화점 감지 + 엔지니어 베이스라인 구간 확정 | P1 |
| F-005 | Step 2 - Residual Gap Analysis | Ridge 회귀 이론 성능 추정, 잔차 시계열 및 저하율 정량화 | P1 |
| F-006 | Step 3 - RUL 예측 | Wiener 프로세스 + Bootstrap 1000회, 신뢰 구간 제공 | P1 |
| F-007 | Step 4 - 건강 점수 산출 | GMM + 마할라노비스 거리 기반 0~100점 건강 점수 계산 | P1 |
| F-008 | 워크플로우 순차 잠금 | Step 1→2→3→4 순서 강제, 각 Step 상태 표시 및 재실행 지원 | P1 |
| F-009 | 데이터 Export | 원본 + 잔차 + 건강 점수 통합 CSV 다운로드 | P2 |

---

## 4. 4단계 ML 워크플로우

```
[데이터 업로드] → [Step 1] → [Step 2] → [Step 3] → [Step 4]
                 베이스라인  잔차 분석   RUL 예측   건강 점수
```

| Step | 목적 | 알고리즘 | 입력 | 출력 |
|------|------|----------|------|------|
| **Step 1** | ESP 운전 패턴 변화점 감지 및 베이스라인 구간 확정 | ruptures PELT (cost: `rbf`) | 전체 시계열 (VFD Freq, Pi 등) | 변화점 날짜 목록, 베이스라인 구간 |
| **Step 2** | 베이스라인 대비 성능 저하 정량화 | Ridge Regression (VFD Freq → Pi) | 베이스라인 구간 데이터 | 잔차 시계열, 저하율(%/month), R² |
| **Step 3** | 잔여 수명(RUL) 확률적 예측 | Wiener Process + Bootstrap (1,000회) | 잔차 시계열 | RUL 중앙값, P10/P90 신뢰 구간 |
| **Step 4** | 다변량 건강 상태 점수화 | GMM (n=2) + Mahalanobis Distance | 6개 피처 (VFD Freq, Motor Current, Motor Temp, Motor Vib, Pi, Pd) | 건강 점수 0~100, 상태 분류 |

**건강 상태 분류**: Normal (≥70) / Degrading (40~69) / Critical (<40)

---

## 5. 데이터 모델 요약

**주요 엔티티**

| 엔티티 | 핵심 필드 | 설명 |
|--------|-----------|------|
| `wells` | id, name, field, latest_health_score, analysis_status | 생산정 메타데이터 |
| `esp_daily_data` | well_id, date, vfd_freq, motor_current, motor_temp, motor_vib, pi, pd, liquid_rate (외 16개 컬럼) | 일별 운전 데이터 (hypertable) |
| `analysis_sessions` | well_id, step_number, status, parameters, celery_task_id | 각 Step 실행 기록 |
| `baseline_periods` | well_id, start_date, end_date, changepoints, is_manually_set | Step 1 결과 |
| `residual_data` | well_id, date, predicted, actual, residual, residual_ma30, degradation_rate | Step 2 결과 |
| `rul_predictions` | well_id, rul_median, rul_p10, rul_p90, expected_failure_date, wiener_drift | Step 3 결과 |
| `health_scores` | well_id, date, mahalanobis_distance, health_score, health_status | Step 4 결과 |

**analysis_status 흐름**: `no_data` → `data_ready` → `baseline_set` → `residual_done` → `rul_done` → `fully_analyzed`

---

## 6. API 구조

| 그룹 | 경로 접두사 | 주요 역할 |
|------|-------------|-----------|
| Well 관리 | `/api/wells` | Well 목록 조회, 상세 정보 |
| 데이터 업로드 | `/api/upload` | Excel 파일 업로드, 파싱, DB 적재 |
| 시계열 데이터 | `/api/wells/{id}/data` | 날짜 범위별 운전 데이터 조회 |
| Step 1 | `/api/wells/{id}/analysis/step1` | PELT 실행, 베이스라인 확정 |
| Step 2 | `/api/wells/{id}/analysis/step2` | Ridge 회귀 실행, 잔차 조회 |
| Step 3 | `/api/wells/{id}/analysis/step3` | RUL 예측 실행 및 결과 조회 |
| Step 4 | `/api/wells/{id}/analysis/step4` | 건강 점수 산출 및 조회 |
| 작업 상태 | `/api/tasks/{task_id}` | Celery 비동기 작업 상태 폴링 |
| Export | `/api/wells/{id}/export` | CSV 다운로드 |

---

## 7. UI 화면 목록

| 화면 ID | 경로 | 설명 |
|---------|------|------|
| SCR-001 | `/` | Well 대시보드 — 전체 Well 카드 그리드, 집계 지표 |
| SCR-002 | `/upload` | 파일 업로드 — 드래그앤드롭, 파싱 진행 상황 |
| SCR-003 | `/wells/[id]` | Well 상세 — 시계열 차트, 워크플로우 패널 |
| SCR-004 | `/wells/[id]/step1` | Step 1 — 변화점 차트, 베이스라인 구간 선택 UI |
| SCR-005 | `/wells/[id]/step2` | Step 2 — 잔차 차트, 저하율 지표 카드 |
| SCR-006 | `/wells/[id]/step3` | Step 3 — RUL 예측 차트, 신뢰 구간, 임계값 설정 |
| SCR-007 | `/wells/[id]/step4` | Step 4 — 건강 점수 시계열, 상태 분류 결과 |

**공통 레이아웃**: 사이드바 네비게이션 (Well 목록) + 상단 워크플로우 진행 표시줄

---

## 8. 비기능 요구사항

| 항목 | 목표 |
|------|------|
| API 응답 시간 | 일반 쿼리 < 500ms |
| ML 분석 시간 | Step별 < 30초 (Celery 비동기) |
| 파일 업로드 한도 | 최대 50MB |
| 데이터 보존 | 원본 데이터 영구 보존, 분석 결과 덮어쓰기 가능 |
| 브라우저 지원 | Chrome 최신, Firefox 최신, Safari 최신 |
| 반응형 | 1280px 이상 데스크톱 최적화 (모바일 미지원) |
| 인증 | MVP 제외 — 단일 사용자 로컬 환경 가정 |
| 가용성 | 로컬 Docker Compose 환경 (SLA 미적용) |

---

## 9. 성공 지표

| KPI | 목표 | 측정 방법 |
|-----|------|-----------|
| Excel 업로드 성공률 | ≥ 95% | 업로드 시도 대비 성공 건수 |
| 분석 완료 시간 | 4단계 전체 < 2분 | Step 1~4 총 소요 시간 |
| 잔차 모델 R² | ≥ 0.80 | Step 2 Ridge 회귀 R² |
| RUL 신뢰 구간 폭 | P10~P90 < 6개월 | Step 3 예측 구간 |
| 건강 점수 정합성 | 육안 검토 일치율 ≥ 80% | 엔지니어 검토 결과 |
| 사용자 만족도 | NPS ≥ 7 | 프로토타입 사용자 테스트 |

---

## 10. 주요 리스크

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| Excel 컬럼 형식 변경 | 높음 | 컬럼 매핑 설정 파일로 분리, 파싱 실패 시 상세 오류 반환 |
| PELT 변화점 과/과소 감지 | 높음 | 민감도(penalty) 파라미터 UI 노출, 수동 구간 지정 허용 |
| Wiener 모델 수렴 실패 | 중간 | 최소 데이터 포인트 검증(≥90일), 실패 시 명확한 오류 메시지 |
| TimescaleDB 로컬 설정 | 중간 | Docker Compose로 환경 고정, 초기화 SQL 스크립트 제공 |
| Celery 작업 유실 | 낮음 | Redis 영속화 설정, 작업 상태 DB 저장 및 재시작 지원 |

---

> **관련 문서**: 구현 세부사항(코드 구조, DB 스키마, API 상세 명세)은 별도 ROADMAP.md 참조
