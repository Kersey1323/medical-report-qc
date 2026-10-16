from app.tasks.celery_app import celery_app


@celery_app.task(name="medical_qc.import", autoretry_for=())
def process_import(import_id):
    from app.db.session import get_factory
    from app.services.import_service import process_import as process

    process(import_id, get_factory())
