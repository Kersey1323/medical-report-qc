"""At least once delivery; uncertain remote work is never silently resubmitted."""

from datetime import timedelta
from sqlalchemy import select, or_
from uuid import UUID
from app.db.models import *
from app.services.common import require
from app.core.logging_config import logger
from app.core.exceptions import error_from_exception


def publish_outbox(factory, publish=None, limit=100):
    if publish is None:
        from app.tasks.celery_app import celery_app

        publish = lambda k, id: celery_app.send_task("medical_qc." + k, args=[id])
    counts = {"published": 0, "errors": 0}
    with factory.begin() as s:
        rows = s.scalars(
            select(TaskOutbox)
            .where(
                TaskOutbox.eligible == True,
                TaskOutbox.published_at == None,
                or_(TaskOutbox.lease_until == None, TaskOutbox.lease_until < now()),
            )
            .order_by(TaskOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        ).all()
        pending = [(b.id, b.kind, b.target_id) for b in rows]
        for b in rows:
            b.lease_until = now() + timedelta(seconds=30)
    for bid, kind, target in pending:
        try:
            publish(kind, target)
            with factory.begin() as s:
                b = require(s, TaskOutbox, bid, True)
                b.published_at = now()
                b.lease_until = None
            counts["published"] += 1
        except Exception as exc:
            counts["errors"] += 1
            with factory.begin() as s:
                require(s, TaskOutbox, bid, True).lease_until = None
            logger.warning(
                "队列发布失败，保留outbox待补发: task_id={}, error_type={}",
                target,
                type(exc).__name__,
            )
    return counts


def _still_expired(m, observed):
    return (
        (m.status, m.generation, m.lease_owner, m.lease_until) == observed
        and m.status in ("running", "failed")
        and (m.lease_until is None or m.lease_until < now())
    )


def recover_once(factory, lookup_remote=None):
    # Requeue expired units to replay orchestration from persisted stages. In-flight
    # GPU success must be polled/validated by its original invoke, not cached raw.
    from app.services.run_service import refresh_run

    counts = {"reclaimed": 0, "reconciled": 0, "errors": 0}
    with factory.begin() as s:
        ids = list(
            s.scalars(
                select(ModuleResult.id).where(
                    ModuleResult.status.in_(["running", "failed"]),
                    or_(
                        ModuleResult.lease_until == None,
                        ModuleResult.lease_until < now(),
                    ),
                )
            )
        )
    for mid in ids:
        with factory.begin() as s:
            m = require(s, ModuleResult, mid)
            rr = require(s, RunReport, m.run_report_id)
            q = require(s, QualityRun, rr.run_id, True)
            m = require(s, ModuleResult, mid, True)
            if m.status not in ("running", "failed") or (
                m.lease_until and m.lease_until >= now()
            ):
                continue
            attempts = s.scalars(
                select(InferenceAttempt).where(
                    InferenceAttempt.module_result_id == mid,
                    InferenceAttempt.generation == m.generation,
                )
            ).all()
            unresolved = [
                a
                for a in attempts
                if a.status == "running"
                or (a.error or {}).get("remote_state")
                in ("running", "queued", "unknown")
            ]
            if m.status == "failed":
                unresolved = [
                    a
                    for a in unresolved
                    if a.stage in ("diagnosis.generate", "csc.correct", "cgec.student")
                ]
                if not unresolved:
                    continue
            info = [(a.id, a.stage, a.remote_request_id) for a in unresolved]
            observed = (m.status, m.generation, m.lease_owner, m.lease_until)
        uncertain = False
        resumable = []
        remote_running = False
        for aid, stage, rid in info:
            if (
                stage not in ("diagnosis.generate", "csc.correct", "cgec.student")
                or lookup_remote is None
            ):
                uncertain = True
                break
            try:
                state = lookup_remote(UUID(rid))
                if state.status in ("running", "queued"):
                    remote_running = True
                    break
                if state.status == "unknown":
                    uncertain = True
                    break
                # Preserve same ID and mark resumable; StageRunner invokes once as GET.
                resumable.append(aid)
            except Exception:
                counts["errors"] += 1
                uncertain = True
                break
        if remote_running:
            with factory.begin() as s:
                m = require(s, ModuleResult, mid)
                rr = require(s, RunReport, m.run_report_id)
                require(s, QualityRun, rr.run_id, True)
                m = require(s, ModuleResult, mid, True)
                if _still_expired(m, observed):
                    m.lease_until = now() + timedelta(seconds=120)
            continue
        if uncertain:
            # No active owner: expose explicit failure retaining attempts and IDs.
            with factory.begin() as s:
                m = require(s, ModuleResult, mid)
                rr = require(s, RunReport, m.run_report_id)
                require(s, QualityRun, rr.run_id, True)
                m = require(s, ModuleResult, mid, True)
                if not _still_expired(m, observed):
                    continue
                m.status = "failed"
                m.finding = None
                m.outcome = {
                    "status": "failed",
                    "finding": None,
                    "error": {
                        "code": "remote_state_unknown",
                        "message": "工作进程租约过期，存在未确认调用；请核对原请求ID后再操作",
                        "stage": "recovery",
                        "retryable": False,
                        "remote_state": "unknown",
                    },
                }
                m.lease_until = None
                m.lease_owner = None
                s.flush()
                refresh_run(s, rr.run_id)
            continue
        with factory.begin() as s:
            m = require(s, ModuleResult, mid)
            rr = require(s, RunReport, m.run_report_id)
            require(s, QualityRun, rr.run_id, True)
            m = require(s, ModuleResult, mid, True)
            if not _still_expired(m, observed):
                continue
            m.status = "pending"
            m.outcome = None
            m.finding = None
            m.lease_owner = None
            m.lease_until = None
            for aid in resumable:
                a = require(s, InferenceAttempt, aid)
                a.status = "resumable"
                a.error = None
            box = s.scalar(
                select(TaskOutbox).where(
                    TaskOutbox.kind == "qc",
                    TaskOutbox.target_id == mid,
                    TaskOutbox.generation == m.generation,
                )
            )
            if box:
                box.published_at = None
                box.lease_until = None
                box.eligible = True
            s.flush()
            refresh_run(s, rr.run_id)
            counts["reclaimed"] += 1
    # Lost Redis messages: durable pending units whose publication is older than lease.
    with factory.begin() as s:
        for box in s.scalars(
            select(TaskOutbox)
            .where(
                TaskOutbox.eligible == True,
                TaskOutbox.published_at < now() - timedelta(seconds=120),
            )
            .with_for_update(skip_locked=True)
        ):
            model = {"qc": ModuleResult, "import": Import, "export": Artifact}[box.kind]
            target = s.get(model, box.target_id)
            if target and (
                target.status == "pending"
                or (
                    box.kind != "qc"
                    and target.status == "running"
                    and target.lease_until
                    and target.lease_until < now()
                )
            ):
                box.published_at = None
                box.lease_until = None
    counts.update(publish_outbox(factory))
    return counts


if __name__ == "__main__":
    import argparse
    from uuid import UUID
    from app.db.session import get_factory
    from app.core.config import get_settings
    from app.clients.inference import InferenceClient

    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.parse_args()
    logger.info(
        "持久任务恢复结果: counts={}",
        recover_once(get_factory(), InferenceClient(get_settings()).get),
    )
