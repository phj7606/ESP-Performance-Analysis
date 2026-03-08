"""
Celery 비동기 태스크 정의

ML 분석(Step 1~3)은 모두 Celery Worker 프로세스에서 비동기 실행.
Celery는 동기 컨텍스트이므로 async 서비스 함수를 asyncio.run()으로 호출.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _get_db_session():
    """
    Celery Worker 전용 DB 세션 컨텍스트 매니저.

    문제: asyncio.run()은 호출마다 새로운 이벤트 루프를 생성한다.
    글로벌 async_engine의 커넥션 풀은 이전 루프에 묶여 있으므로,
    두 번째 태스크부터 "Future attached to a different loop" 에러가 발생한다.

    해결: 태스크마다 새로운 엔진을 생성해 현재 루프에 바인딩하고,
    태스크 완료 후 engine.dispose()로 커넥션을 정리한다.
    """
    from app.core.config import settings
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    engine = create_async_engine(settings.DATABASE_URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with factory() as session:
            yield session
    finally:
        # 이벤트 루프 종료 전 커넥션 풀 완전 해제 (루프 전환 시 자원 누수 방지)
        await engine.dispose()


@celery_app.task(bind=True, name="app.worker.tasks.task_run_step1")
def task_run_step1(
    self,
    well_id: str,
    sg_oil: float = 0.85,
    sg_water: float = 1.03,
):
    """
    Step 1: 4개 무차원 성능 지수 계산 비동기 태스크.

    전체 기간에 대해 Cp, ψ, V_std, T_eff, η_proxy 계산 후 DB 저장.
    상태: data_ready → diagnosis_done
    """
    async def _run():
        from app.services.step1_diagnosis import run_step1_analysis
        from app.models.analysis import AnalysisSession
        from sqlalchemy import select

        async with _get_db_session() as db:
            stmt = select(AnalysisSession).where(
                AnalysisSession.well_id        == well_id,
                AnalysisSession.step_number    == 1,
                AnalysisSession.celery_task_id == self.request.id,
            )
            result = await db.execute(stmt)
            session_row = result.scalar_one_or_none()
            if session_row:
                session_row.status = "running"
                await db.commit()

            try:
                result_data = await run_step1_analysis(
                    well_id=well_id,
                    sg_oil=sg_oil,
                    sg_water=sg_water,
                    db=db,
                )
                if session_row:
                    session_row.status = "completed"
                    await db.commit()
                return result_data

            except Exception as exc:
                logger.exception("Step 1 analysis failed: well_id=%s", well_id)
                if session_row:
                    session_row.status = "failed"
                    session_row.error_message = str(exc)
                    await db.commit()
                raise

    return asyncio.run(_run())


@celery_app.task(bind=True, name="app.worker.tasks.task_run_step2")
def task_run_step2(
    self,
    well_id: str,
):
    """
    Step 2: Trend-Residual 건강 점수 산출 비동기 태스크 (기본 Step 2로 전환).

    MA30 기준선 + 잔차 σ 이탈 감점 + 기울기 감점 → 건강 점수 10~100.
    상태: diagnosis_done → health_done (Trend-Residual이 기본 Step 2)
    """
    async def _run():
        # Step 2/2b 스왑: task_run_step2는 이제 Trend-Residual(run_step2b_analysis)을 호출
        from app.services.step2_health import run_step2b_analysis
        from app.models.analysis import AnalysisSession
        from sqlalchemy import select

        async with _get_db_session() as db:
            stmt = select(AnalysisSession).where(
                AnalysisSession.well_id        == well_id,
                AnalysisSession.step_number    == 2,
                AnalysisSession.celery_task_id == self.request.id,
            )
            result = await db.execute(stmt)
            session_row = result.scalar_one_or_none()
            if session_row:
                session_row.status = "running"
                await db.commit()

            try:
                result_data = await run_step2b_analysis(
                    well_id=well_id,
                    db=db,
                )
                if session_row:
                    session_row.status = "completed"
                    await db.commit()
                return result_data

            except Exception as exc:
                logger.exception("Step 2 analysis failed: well_id=%s", well_id)
                if session_row:
                    session_row.status = "failed"
                    session_row.error_message = str(exc)
                    await db.commit()
                raise

    return asyncio.run(_run())


@celery_app.task(bind=True, name="app.worker.tasks.task_run_step2b")
def task_run_step2b(
    self,
    well_id: str,
):
    """
    Step 2-B: GMM Log-Likelihood Health Scoring 비동기 태스크 (보조 분석으로 전환).

    EWMA(span=7) + Rolling GMM + Piecewise Linear 정규화 → 건강 점수 0~100.
    Trend-Residual(기본 Step 2)과 독립 실행 (health_scores 테이블에 저장).
    상태: 변경 없음 — 보조 분석이므로 워크플로우 상태 미갱신
    """
    async def _run():
        # Step 2/2b 스왑: task_run_step2b는 이제 GMM(run_step2_analysis)을 호출
        from app.services.step2_health import run_step2_analysis
        from app.models.analysis import AnalysisSession
        from sqlalchemy import select

        async with _get_db_session() as db:
            stmt = select(AnalysisSession).where(
                AnalysisSession.well_id        == well_id,
                AnalysisSession.step_number    == 20,   # Step 2-B 내부 식별 번호
                AnalysisSession.celery_task_id == self.request.id,
            )
            result = await db.execute(stmt)
            session_row = result.scalar_one_or_none()
            if session_row:
                session_row.status = "running"
                await db.commit()

            try:
                result_data = await run_step2_analysis(
                    well_id=well_id,
                    db=db,
                )
                if session_row:
                    session_row.status = "completed"
                    await db.commit()
                return result_data

            except Exception as exc:
                logger.exception("Step 2-B analysis failed: well_id=%s", well_id)
                if session_row:
                    session_row.status = "failed"
                    session_row.error_message = str(exc)
                    await db.commit()
                raise

    return asyncio.run(_run())


@celery_app.task(bind=True, name="app.worker.tasks.task_run_step3")
def task_run_step3(
    self,
    well_id: str,
):
    """
    Step 3: 3-Pillar 독립 고장 모드 알람 분석 비동기 태스크.

    P1 (Hydraulic): ψ_ma30 Mann-Kendall 하락 추세 + CRITICAL 임계치
    P2 (Mechanical): v_std_ma30 Mann-Kendall 상승 추세 + CRITICAL 임계치
    P3 (Electrical): current_leak 절대값 + 3일 지속 조건
    상태: health_done → fully_analyzed
    """
    async def _run():
        from app.services.step3_rul import run_step3_analysis
        from app.models.analysis import AnalysisSession
        from sqlalchemy import select

        async with _get_db_session() as db:
            stmt = select(AnalysisSession).where(
                AnalysisSession.well_id        == well_id,
                AnalysisSession.step_number    == 3,
                AnalysisSession.celery_task_id == self.request.id,
            )
            result = await db.execute(stmt)
            session_row = result.scalar_one_or_none()
            if session_row:
                session_row.status = "running"
                await db.commit()

            try:
                result_data = await run_step3_analysis(
                    well_id=well_id,
                    db=db,
                )
                if session_row:
                    session_row.status = "completed"
                    await db.commit()
                return result_data

            except Exception as exc:
                logger.exception("Step 3 analysis failed: well_id=%s", well_id)
                if session_row:
                    session_row.status = "failed"
                    session_row.error_message = str(exc)
                    await db.commit()
                raise

    return asyncio.run(_run())
