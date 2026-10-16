from app.db.models import Report
from app.services.common import digest


def create_report(session, data, original_row=None):
    r = Report(
        description=data.description,
        diagnosis=data.diagnosis,
        extra_fields=data.extra_fields,
        original_row=original_row,
        source_hash=digest([data.description, data.diagnosis]),
    )
    session.add(r)
    session.flush()
    return r
