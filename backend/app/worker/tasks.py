from app.worker.celery_app import celery_app


@celery_app.task(bind=True)
def placeholder_task(self):
    """
    MVP 단계에서는 Celery 연결 확인용 플레이스홀더.
    Step 1~4 ML 분석 태스크는 이후 Sprint에서 구현.
    """
    return {"status": "ok"}
