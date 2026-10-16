from fastapi import Request, BackgroundTasks
from app.db.session import get_factory


def session(request: Request, background_tasks: BackgroundTasks):
    factory = getattr(request.app.state, "session_factory", None) or get_factory()
    with factory() as s:
        try:
            yield s
            s.commit()
            if request.method == "POST" and not hasattr(
                request.app.state, "session_factory"
            ):
                from app.tasks.recovery import publish_outbox

                background_tasks.add_task(publish_outbox, factory)
        except BaseException:
            s.rollback()
            raise
