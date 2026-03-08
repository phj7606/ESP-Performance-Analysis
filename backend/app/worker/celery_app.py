from celery import Celery

from app.core.config import settings

# Initialize Celery app
# broker: task queue (Redis)
# backend: task result store (Redis)
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
    # Update task status to STARTED when execution begins (improves polling UX)
    task_track_started=True,
    # Task result retention period (1 day)
    result_expires=86400,
)
