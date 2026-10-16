"""Renew job leases while parsing/building; every publication is owner fenced."""

from datetime import timedelta
from threading import Event, Thread
from app.db.models import now
from app.services.common import require


class RenewingLease:
    def __init__(self, factory, model, id, owner, seconds=120, interval=30):
        self.factory, self.model, self.id, self.owner = factory, model, id, owner
        self.seconds, self.interval = seconds, interval
        self.stop = Event()
        self.thread = Thread(target=self._renew, daemon=True)

    def owns(self, row):
        return (
            row.status == "running"
            and row.lease_owner == self.owner
            and row.lease_until is not None
            and row.lease_until > now()
        )

    def _renew(self):
        while not self.stop.wait(self.interval):
            try:
                with self.factory.begin() as s:
                    row = require(s, self.model, self.id, True)
                    if not self.owns(row):
                        return
                    row.lease_until = now() + timedelta(seconds=self.seconds)
            except Exception:
                # Failed renewal never authorizes a stale publication; commit checks DB.
                from app.core.logging_config import logger

                logger.warning("后台任务续租失败: task_id={}", self.id)
                return

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.stop.set()
        self.thread.join(timeout=5)
