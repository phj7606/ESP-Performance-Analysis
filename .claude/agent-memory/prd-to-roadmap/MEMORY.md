# PRD to ROADMAP 에이전트 메모리

## 프로젝트 상태
- **PRD 버전**: v1.1.0 (2026-03-03)
- **ROADMAP 생성 완료**: `docs/ROADMAP.md` (791줄, 2026-03-03)
- **핵심 파일**: `PRD.md` (루트), `CLAUDE.md` (루트), `docs/ROADMAP.md`

## 로드맵 구성 요약

### 총 7일 / 40개 태스크
| Day | 핵심 목표 | 주요 산출물 |
|-----|----------|------------|
| Day 1 | 인프라 + Docker Compose + DB 스키마 | docker-compose.yml, init.sql, ORM 모델, Alembic |
| Day 2 | 백엔드 핵심 API (업로드 + Well 관리) | POST /api/upload, GET /api/wells, GET /api/wells/{id}/data |
| Day 3 | 프론트엔드 기반 + 대시보드 + 업로드 UI | Next.js 초기화, api.ts, store.ts, SCR-001, SCR-002 |
| Day 4 | Well 상세 + 시계열 차트 + Step 1 PELT | TimeSeriesChart, step1_pelt.py, SCR-003, SCR-004 |
| Day 5 | Step 2 Ridge 회귀 잔차 분석 | step2_ridge.py, SCR-005, R²≥0.80 검증 |
| Day 6 | Step 3 RUL + Step 4 건강 점수 | step3_rul.py, step4_health.py, SCR-006, SCR-007 |
| Day 7 | CSV Export + E2E 테스트 + QA | export API, QA_REPORT.md, SETUP.md |

## 핵심 기술 결정사항 (로드맵에 반영)

### 고위험 항목 (조기 배치)
- **react-plotly.js SSR**: `next/dynamic + ssr: false` 필수 — Day 4 CHART-1에서 처리
- **PELT penalty 파라미터**: UI 슬라이더로 노출 필수 (과/과소 감지 리스크 대응)
- **Redis 영속화**: `appendonly yes` 필수 — Celery 태스크 유실 방지

### 데이터 처리 주의사항
- Well 이름 정규화: `normalize_well_name()` 함수 — Day 2 API-2에서 구현
- Null 컬럼: `liquid_rate`, `water_rate`, `oil_haimo`, `gas_meter` — NULL 저장
- Step 4 피처 6개 고정: `vfd_freq`, `motor_current`, `motor_temp`, `motor_vib`, `pi`, `pd`
- Step 3 최소 90일 잔차 데이터 검증 필수

### 병렬 개발 가능 구간
- Day 6의 Step 3(ML-6~7)과 Step 4(ML-8~9)는 독립적으로 병렬 개발 가능

## 자기 검증 결과
- [x] PRD 9개 기능(F-001~F-009) 전체 로드맵에 반영
- [x] MVP 제외 항목 명확히 분리 (BOCPD, LSTM, PDF, 다중Well, 스트리밍, Auth)
- [x] 기술적 의존성 Mermaid 다이어그램으로 시각화
- [x] 각 Day에 완료 기준(DoD) 명시
- [x] 5개 PRD 리스크 + react-plotly.js SSR 추가 리스크 대응 전략 수립
- [x] 성공 지표 (R²≥0.80, RUL 구간<180일) 검증 태스크 Day 7에 배치
