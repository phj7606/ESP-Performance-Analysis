"""
분석 API 라우터: Step 1~3 (3-Step 파이프라인)

엔드포인트:
- POST /wells/{well_id}/analysis/step1  — Step 1 실행: 성능 진단 (Celery 비동기)
- GET  /wells/{well_id}/analysis/step1  — Step 1 결과 조회: 4개 무차원 지수
- POST /wells/{well_id}/analysis/step2  — Step 2 실행: 건강 점수 (Celery 비동기)
- GET  /wells/{well_id}/analysis/step2  — Step 2 결과 조회: 건강 점수 시계열
- POST /wells/{well_id}/analysis/step3  — Step 3 실행: RUL 예측 (Celery 비동기)
- GET  /wells/{well_id}/analysis/step3  — Step 3 결과 조회: Prophet RUL
- GET  /tasks/{task_id}                 — Celery 태스크 상태 조회
"""
from __future__ import annotations

import uuid
import logging
from typing import Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.analysis import AnalysisSession
from app.models.well import Well
from app.schemas.analysis import (
    Step1RunRequest,
    Step1IndexPoint,
    Step1ResultResponse,
    Step2ResultResponse,
    Step2HealthPoint,
    Step2bResultResponse,
    Step2bScorePoint,
    Step3RunRequest,
    Step3PillarResponse,
    TaskStatusResponse,
)
from app.services.step1_diagnosis import get_step1_result
# Step 2/2b 스왑: get_step2_result=GMM(step2b 엔드포인트), get_step2b_result=Trend-Residual(step2 엔드포인트)
from app.services.step2_health import get_step2_result, get_step2b_result
from app.services.step3_rul import get_step3_result
from app.worker.celery_app import celery_app

router = APIRouter()
logger = logging.getLogger(__name__)

# ============================================================
# 워크플로우 순서 강제 유틸리티
# ============================================================

# 상태 순서: 높은 숫자 = 더 진행된 상태
STATUS_ORDER = [
    "no_data",
    "data_ready",
    "diagnosis_done",
    "health_done",
    "fully_analyzed",
]


def require_min_status(current: str, min_status: str) -> None:
    """
    현재 분석 상태가 최소 요구 상태를 충족하는지 검증.
    미충족 시 HTTP 422 반환.
    """
    current_idx  = STATUS_ORDER.index(current)  if current  in STATUS_ORDER else -1
    required_idx = STATUS_ORDER.index(min_status) if min_status in STATUS_ORDER else -1

    if current_idx < required_idx:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"워크플로우 오류: 현재 상태 '{current}'에서 분석을 실행할 수 없습니다. "
                f"최소 요구 상태: '{min_status}'."
            ),
        )


async def get_well_or_404(well_id: str, db: AsyncSession) -> Well:
    """Well 조회 공통 헬퍼. 없으면 404 반환."""
    try:
        well_uuid = uuid.UUID(well_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Well ID format.")

    result = await db.execute(select(Well).where(Well.id == well_uuid))
    well = result.scalar_one_or_none()
    if not well:
        raise HTTPException(status_code=404, detail=f"Well ID '{well_id}' not found.")
    return well


# ============================================================
# Step 1 엔드포인트: 성능 진단
# ============================================================

@router.post(
    "/wells/{well_id}/analysis/step1",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Step 1 실행: 성능 진단 (Celery 비동기)",
)
async def run_step1(
    well_id: str,
    body: Step1RunRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    전체 기간 무차원 성능 지수(Cp, ψ, V_std, T_eff) 계산.
    Celery 비동기 태스크로 실행 → task_id 즉시 반환.

    선행 조건: analysis_status >= 'data_ready' (데이터 업로드 완료)
    """
    well = await get_well_or_404(well_id, db)
    require_min_status(well.analysis_status, "data_ready")

    from app.worker.tasks import task_run_step1
    task = task_run_step1.delay(
        well_id=str(well.id),
        sg_oil=body.sg_oil,
        sg_water=body.sg_water,
    )

    session = AnalysisSession(
        well_id=well.id,
        step_number=1,
        status="pending",
        parameters={"sg_oil": body.sg_oil, "sg_water": body.sg_water},
        celery_task_id=task.id,
    )
    db.add(session)
    await db.commit()

    return {"task_id": task.id}


@router.get(
    "/wells/{well_id}/analysis/step1",
    response_model=Step1ResultResponse,
    summary="Step 1 결과 조회: 4개 무차원 성능 지수 시계열",
)
async def get_step1(
    well_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    저장된 Step 1 결과(4개 무차원 지수 시계열)를 반환.
    분석 미완료 시 404 반환.
    """
    well = await get_well_or_404(well_id, db)

    try:
        data = await get_step1_result(well_id=str(well.id), db=db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return Step1ResultResponse(
        well_id=data["well_id"],
        sg_oil=data["sg_oil"],
        sg_water=data["sg_water"],
        data_start=data.get("data_start"),
        data_end=data.get("data_end"),
        psi_whp_coeff=data.get("psi_whp_coeff"),
        psi_whp_intercept=data.get("psi_whp_intercept"),
        psi_whp_r2=data.get("psi_whp_r2"),
        psi_whp_n_samples=data.get("psi_whp_n_samples"),
        indices=[Step1IndexPoint(**r) for r in data["indices"]],
    )


# ============================================================
# Step 2 엔드포인트: 건강 점수
# ============================================================

@router.post(
    "/wells/{well_id}/analysis/step2",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Step 2 실행: 건강 점수 산출 (Celery 비동기)",
)
async def run_step2(
    well_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    CV 자동 학습 구간 탐지 + GMM 학습 + 마할라노비스 건강 점수 계산.
    Celery 비동기 태스크로 실행 → task_id 즉시 반환.

    선행 조건: analysis_status >= 'diagnosis_done' (Step 1 완료)
    """
    well = await get_well_or_404(well_id, db)
    require_min_status(well.analysis_status, "diagnosis_done")

    from app.worker.tasks import task_run_step2
    task = task_run_step2.delay(well_id=str(well.id))

    session = AnalysisSession(
        well_id=well.id,
        step_number=2,
        status="pending",
        parameters={},
        celery_task_id=task.id,
    )
    db.add(session)
    await db.commit()

    return {"task_id": task.id}


@router.get(
    "/wells/{well_id}/analysis/step2",
    response_model=Step2bResultResponse,
    summary="Step 2 결과 조회: Trend-Residual 건강 점수 시계열 (기본 Step 2)",
)
async def get_step2(
    well_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    저장된 Step 2 결과(Trend-Residual 건강 점수 시계열)를 반환.
    Step 2가 이제 Trend-Residual(기본) → trend_residual_scores 테이블에서 조회.
    분석 미완료 시 404 반환.
    """
    well = await get_well_or_404(well_id, db)

    try:
        data = await get_step2b_result(well_id=str(well.id), db=db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return Step2bResultResponse(
        well_id=data["well_id"],
        rows_written=len(data["scores"]),
        scores=[Step2bScorePoint(**r) for r in data["scores"]],
    )


# ============================================================
# Step 2-B 엔드포인트: Trend-Residual Health Scoring
# ============================================================

@router.post(
    "/wells/{well_id}/analysis/step2b",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Step 2-B 실행: Trend-Residual 건강 점수 (Celery 비동기)",
)
async def run_step2b(
    well_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2-B: GMM Log-Likelihood 방식 건강 점수 계산 (보조 분석).
    Trend-Residual(Step 2)과 독립 실행 → Celery 비동기 태스크 → task_id 즉시 반환.

    선행 조건: analysis_status >= 'diagnosis_done' (Step 1 완료) — Step 2보다 먼저 실행 가능
    """
    well = await get_well_or_404(well_id, db)
    require_min_status(well.analysis_status, "diagnosis_done")

    from app.worker.tasks import task_run_step2b
    task = task_run_step2b.delay(well_id=str(well.id))

    session = AnalysisSession(
        well_id=well.id,
        step_number=20,          # Step 2-B: 내부 식별용 20번 (Step 1~3와 충돌 방지)
        status="pending",
        parameters={},
        celery_task_id=task.id,
    )
    db.add(session)
    await db.commit()

    return {"task_id": task.id}


@router.get(
    "/wells/{well_id}/analysis/step2b",
    response_model=Step2ResultResponse,
    summary="Step 2-B 결과 조회: GMM 건강 점수 시계열 (보조 분석)",
)
async def get_step2b(
    well_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    저장된 Step 2-B 결과(GMM 건강 점수 시계열 + 피처 기여도)를 반환.
    Step 2-B가 이제 GMM(보조) → health_scores 테이블에서 조회.
    분석 미완료 시 404 반환.
    """
    well = await get_well_or_404(well_id, db)

    try:
        data = await get_step2_result(well_id=str(well.id), db=db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return Step2ResultResponse(
        well_id=data["well_id"],
        training_start=data.get("training_start"),
        training_end=data.get("training_end"),
        features_used=data.get("features_used", []),
        k_factor=data.get("k_factor"),
        scores=[Step2HealthPoint(**r) for r in data["scores"]],
    )


# ============================================================
# Step 3 엔드포인트: RUL 예측
# ============================================================

@router.post(
    "/wells/{well_id}/analysis/step3",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Step 3 실행: 3-Pillar 고장 모드 알람 (Celery 비동기)",
)
async def run_step3(
    well_id: str,
    body: Step3RunRequest = None,
    db: AsyncSession = Depends(get_db),
):
    """
    3-Pillar 독립 고장 모드 알람 분석:
      P1 (Hydraulic): ψ_ma30 Mann-Kendall 하락 추세
      P2 (Mechanical): v_std_ma30 Mann-Kendall 상승 추세
      P3 (Electrical): current_leak 절대값 + 3일 지속 조건

    Celery 비동기 태스크로 실행 → task_id 즉시 반환.
    선행 조건: analysis_status >= 'health_done' (Step 2 완료)
    """
    if body is None:
        body = Step3RunRequest()

    well = await get_well_or_404(well_id, db)
    require_min_status(well.analysis_status, "health_done")

    from app.worker.tasks import task_run_step3
    task = task_run_step3.delay(well_id=str(well.id))

    session = AnalysisSession(
        well_id=well.id,
        step_number=3,
        status="pending",
        parameters={},
        celery_task_id=task.id,
    )
    db.add(session)
    await db.commit()

    return {"task_id": task.id}


@router.get(
    "/wells/{well_id}/analysis/step3",
    response_model=Step3PillarResponse,
    summary="Step 3 결과 조회: 3-Pillar 고장 모드 알람",
)
async def get_step3(
    well_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    저장된 Step 3 결과(3-Pillar 독립 알람: Hydraulic / Mechanical / Electrical)를 반환.
    분석 미완료 시 404 반환.
    """
    well = await get_well_or_404(well_id, db)

    try:
        data = await get_step3_result(well_id=str(well.id), db=db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return Step3PillarResponse(
        well_id=data["well_id"],
        computed_at=data.get("computed_at"),
        pillar1=data["pillar1"],
        pillar2=data["pillar2"],
        pillar3=data["pillar3"],
    )


# ============================================================
# Celery 태스크 상태 조회
# ============================================================

@router.get(
    "/tasks/{task_id}",
    response_model=TaskStatusResponse,
    summary="Celery 태스크 상태 조회",
)
async def get_task_status(task_id: str):
    """
    Celery 비동기 태스크의 현재 상태를 반환.
    프론트엔드가 2초 간격으로 폴링하여 완료를 감지한다.

    상태값:
    - PENDING: 아직 시작 안 됨 (Worker 큐 대기)
    - STARTED: 실행 중
    - SUCCESS: 완료
    - FAILURE: 실패
    """
    task_result = AsyncResult(task_id, app=celery_app)

    error: Optional[str] = None
    result: Optional[dict] = None

    if task_result.state == "FAILURE":
        error = str(task_result.result) if task_result.result else "Unknown error"
    elif task_result.state == "SUCCESS":
        raw = task_result.result
        result = raw if isinstance(raw, dict) else None

    return TaskStatusResponse(
        task_id=task_id,
        status=task_result.state,
        result=result,
        error=error,
    )
