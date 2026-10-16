from app.tasks.celery_app import celery_app
from functools import lru_cache


@lru_cache
def executor():
    from app.services.pipeline_executor import build_executor
    from app.core.config import get_settings
    from app.db.session import get_factory

    return build_executor(get_settings(), get_factory())


@celery_app.task(name="medical_qc.qc", autoretry_for=())
def process_qc_unit(module_result_id):
    from app.db.session import get_factory
    from app.services.execution_service import execute_unit
    from app.services.pipeline_executor import build_executor
    from app.core.config import get_settings
    from app.core.logging_config import configure_logging

    settings = get_settings()
    configure_logging(
        settings.app_log_dir, service="worker", instance_id=settings.instance_id
    )
    factory = get_factory()
    execute_unit(module_result_id, executor(), factory)
