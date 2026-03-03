from celery import Celery

from app.core.config import settings

# Celery 앱 초기화
# broker: 작업 큐 (Redis)
# backend: 작업 결과 저장소 (Redis)
celery_app = Celery(
    "esp_worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.worker.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # 작업 시작 시 상태를 STARTED로 업데이트 (폴링 UX 개선)
    task_track_started=True,
    # 작업 결과 보존 시간 (1일)
    result_expires=86400,
)
