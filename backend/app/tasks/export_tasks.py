from app.tasks.celery_app import celery_app


@celery_app.task(name="medical_qc.export", autoretry_for=())
def process_export(artifact_id):
    from app.db.session import get_factory
    from app.core.config import get_settings
    from app.services.export_service import build_export

    build_export(artifact_id, get_factory(), get_settings())
