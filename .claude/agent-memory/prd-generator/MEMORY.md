# PRD Generator - Agent Memory

## 프로젝트 컨텍스트

- **프로젝트**: ESP-PAS (ESP Performance Analysis System)
- **경로**: `/Users/mac/Workspace/SKEO/ESP-Peroformance-Analysis/`
- **PRD 경로**: `/Users/mac/Workspace/SKEO/ESP-Peroformance-Analysis/PRD.md`
- **데이터**: Production Data.xlsx (LF12-3-A1H Well, 2023-09-22~2026-02-28, 25개 컬럼)

## PRD 구조 패턴 (확정)

간결 PRD(200~300줄)는 다음 10개 섹션으로 구성:
1. 제품 개요 (문제 표, 사용자, MVP 포함/제외 표)
2. 기술 스택 (레이어별 표 + 이유 1줄)
3. 핵심 기능 (F-001~F-009 표 형식, 우선순위만)
4. ML 워크플로우 (Step별 목적/알고리즘 표)
5. 데이터 모델 요약 (엔티티+핵심 필드 표)
6. API 구조 (그룹별 표)
7. UI 화면 목록 (화면 ID, 경로, 설명 표)
8. 비기능 요구사항 (수치 표)
9. 성공 지표 (KPI 표)
10. 주요 리스크 (5개, 한 줄씩)

## 기술 스택 (확정)

- Frontend: Next.js 15 + React 19 + TypeScript + Tailwind CSS + shadcn/ui
- 차트: Plotly.js (react-plotly.js) — 다중 축 시계열 필수
- 상태: Zustand 5.x + TanStack Query 5.x
- Backend: FastAPI 0.115.x + Celery + Redis
- DB: TimescaleDB (PostgreSQL 15) + SQLAlchemy 2.x + asyncpg
- ML: ruptures, scikit-learn, lifelines
- 컨테이너: Docker Compose

## ML 파이프라인 (확정)

- Step 1: ruptures PELT (변화점 감지) → 베이스라인 구간 확정
- Step 2: Ridge Regression (VFD Freq → Pi 잔차) → 저하율 정량화
- Step 3: Wiener Process + Bootstrap 1000회 → RUL P10/P50/P90
- Step 4: GMM (n=2) + Mahalanobis Distance → 건강 점수 0~100

## 사용자 선호사항

- PRD 간결화 요청: 코드 스니펫, SQL 스키마, TS 인터페이스 전체, 디렉토리 구조 제외
- 구현 세부사항은 별도 ROADMAP.md로 분리
- 언어: 한국어
- 코드: TypeScript 우선
