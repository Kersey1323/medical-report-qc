from celery import Celery
from app.core.config import get_settings

settings = get_settings()
celery_app = Celery(
    "medical_qc",
    broker=settings.redis_broker_url,
    include=["app.tasks.qc_tasks", "app.tasks.import_tasks", "app.tasks.export_tasks"],
)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    worker_pool="threads",
    worker_concurrency=4,
    task_default_queue="medical_qc",
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "global_keyprefix": settings.redis_prefix,
        "visibility_timeout": 3600,
    },
    task_serializer="json",
    accept_content=["json"],
    task_ignore_result=True,
    task_publish_retry=False,
    broker_connection_timeout=3,
)


# Celery owns process setup; route its standard logging into our single Loguru
# configuration instead of replacing the file/console sinks per task.
from celery.signals import setup_logging


@setup_logging.connect
def configure_worker_logging(**kwargs):
    from app.core.logging_config import configure_logging
    from app.core.exceptions import register_secrets

    register_secrets(
        settings.database_url,
        settings.model_service_token,
        settings.judge_api_key,
        settings.teacher_api_key,
        settings.localizer_api_key,
    )
    configure_logging(
        settings.app_log_dir,
        service="worker",
        instance_id=settings.instance_id,
        reset=True,
    )
