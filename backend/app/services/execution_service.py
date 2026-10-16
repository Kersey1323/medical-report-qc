"""Short transactions around external calls; only durable state confirms completion."""

from datetime import timedelta
from threading import Event, Thread
from time import sleep
from uuid import UUID, uuid4
from sqlalchemy import select
from app.db.models import *
from app.domain.results import (
    ReportInput,
    RunConfig,
    StageContext,
    StageOutput,
    BranchOutcome,
)
from app.services.common import require
from app.services.run_service import refresh_run
from app.core.exceptions import (
    AppError,
    Cancelled,
    error_from_exception,
    fail,
    protected_values,
)
from app.core.logging_config import logger


class StageRunner:
    def __init__(self, factory):
        self.factory = factory

    def run(self, stage, chunk_key, input_hash, context, invoke):
        mid = str(context.module_result_id)
        cfg = context.config.fingerprint
        with self.factory.begin() as s:
            prior = s.scalars(
                select(InferenceAttempt)
                .where(
                    InferenceAttempt.module_result_id == mid,
                    InferenceAttempt.stage == stage,
                    InferenceAttempt.chunk_key == chunk_key,
                    InferenceAttempt.input_hash == input_hash,
                    InferenceAttempt.config_hash == cfg,
                )
                .order_by(
                    InferenceAttempt.generation.desc(),
                    InferenceAttempt.attempt_no.desc(),
                )
            ).all()
            success = next((a for a in prior if a.status == "succeeded"), None)
            if success:
                if success.generation != context.generation:
                    s.add(
                        InferenceAttempt(
                            module_result_id=mid,
                            generation=context.generation,
                            stage=stage,
                            chunk_key=chunk_key,
                            attempt_no=1,
                            input_hash=input_hash,
                            config_hash=cfg,
                            remote_request_id=success.remote_request_id,
                            status="succeeded",
                            output=success.output,
                            identity=success.identity,
                            reused_from_attempt_id=success.id,
                            origin_request_id=str(context.request_id)
                            if context.request_id
                            else None,
                        )
                    )
                return StageOutput.model_validate(success.output)
            current = [a for a in prior if a.generation == context.generation]
            if any(
                a.status == "running"
                or (a.error or {}).get("remote_state")
                in ("running", "queued", "unknown")
                for a in prior
            ):
                # Recovery must reconcile first. Do not repeat an uncertain online call.
                raise fail(
                    "remote_state_unknown",
                    "阶段存在未确认完成的调用，等待恢复核对",
                    "recovery",
                    False,
                )
            resumable = next((a for a in current if a.status == "resumable"), None)
            resume_info = (
                (resumable.id, resumable.remote_request_id, resumable.attempt_no)
                if resumable
                else None
            )
            used = max((a.attempt_no for a in current), default=0)
            if not resume_info and (
                used >= 3
                or (
                    current
                    and current[0].error
                    and not current[0].error.get("retryable")
                )
            ):
                raise AppError(
                    __import__(
                        "contracts.errors", fromlist=["ErrorDetail"]
                    ).ErrorDetail.model_validate(current[0].error)
                )
        first_attempt = resume_info[2] if resume_info else used + 1
        for attempt_no in range(first_attempt, 4):
            if context.cancel_requested():
                raise Cancelled()
            context.heartbeat()
            is_resume = bool(resume_info and attempt_no == resume_info[2])
            if is_resume:
                aid, remote_id, _ = resume_info
                rid = UUID(remote_id)
            else:
                rid = uuid4()
                with self.factory.begin() as s:
                    a = InferenceAttempt(
                        module_result_id=mid,
                        generation=context.generation,
                        stage=stage,
                        chunk_key=chunk_key,
                        attempt_no=attempt_no,
                        input_hash=input_hash,
                        config_hash=cfg,
                        remote_request_id=str(rid),
                        origin_request_id=str(context.request_id)
                        if context.request_id
                        else None,
                    )
                    s.add(a)
                    s.flush()
                    aid = a.id
            with logger.contextualize(
                stage=stage,
                attempt=attempt_no,
                max_attempts=3,
                inference_request_id=str(rid),
            ):
                try:
                    from app.clients.inference import resuming_remote

                    token = resuming_remote.set(is_resume)
                    try:
                        output = invoke(rid, attempt_no)
                    finally:
                        resuming_remote.reset(token)
                    with self.factory.begin() as s:
                        a = require(s, InferenceAttempt, aid)
                        a.status = "succeeded"
                        a.error = None
                        a.output = output.model_dump(mode="json")
                        a.identity = output.identity
                        a.raw_response = output.payload.get("raw_text")
                    return output
                except Cancelled:
                    raise
                except Exception as exc:
                    detail = error_from_exception(exc, stage)
                    # Running/unknown remote calls cannot be retried with a new ID.
                    if detail.remote_state in ("running", "queued", "unknown"):
                        detail = detail.model_copy(update={"retryable": False})
                    with self.factory.begin() as s:
                        a = require(s, InferenceAttempt, aid)
                        a.status = "failed"
                        a.error = detail.model_dump(mode="json")
                        a.raw_response = getattr(exc, "raw_response", None)
                        a.identity = getattr(exc, "identity", {})
                    logger.warning(
                        "阶段调用失败: error_code={}, attempt={}, max_attempts=3",
                        detail.code,
                        attempt_no,
                    )
                    if not detail.retryable or attempt_no == 3:
                        raise AppError(detail) from exc
                    sleep(min(0.25 * 2 ** (attempt_no - 1), 2))
        raise RuntimeError("unreachable")


def execute_unit(id, executor, factory, lease_seconds=120, heartbeat_seconds=15):
    owner = uid()
    with factory.begin() as s:
        m = require(s, ModuleResult, id)
        rr = require(s, RunReport, m.run_report_id)
        q = require(s, QualityRun, rr.run_id, True)
        m = require(s, ModuleResult, id, True)
        if m.status != "pending" or not q.started_at:
            return
        if q.cancel_requested:
            m.status = "cancelled"
            m.outcome = BranchOutcome(status="cancelled").model_dump(mode="json")
            s.flush()
            refresh_run(s, q.id)
            return
        m.status = "running"
        m.lease_owner = owner
        m.lease_until = now() + timedelta(seconds=lease_seconds)
        m.heartbeat_at = now()
        report = require(s, Report, rr.report_id)
        original = ReportInput(
            id=report.id,
            description=report.description,
            diagnosis=report.diagnosis,
            original_row=report.original_row,
            extra_fields=report.extra_fields,
        )
        config = RunConfig(
            checks=q.checks,
            fingerprint=q.config_fingerprint,
            snapshot=q.config_snapshot,
            profiles=q.config_snapshot.get("profiles", {}),
        )
        generation = m.generation
        branch = m.branch
        runid = q.id
        rrid = rr.id
        origin = q.origin_request_id
        refresh_run(s, runid)
    stopped = Event()
    heartbeat_error = []

    def heartbeat():
        with factory.begin() as s:
            m = require(s, ModuleResult, id, True)
            if m.lease_owner != owner or m.generation != generation:
                raise fail("lease_lost", "执行租约已变更", "execution.heartbeat")
            m.lease_until = now() + timedelta(seconds=lease_seconds)
            m.heartbeat_at = now()

    def keep_alive():
        while not stopped.wait(heartbeat_seconds):
            try:
                heartbeat()
            except Exception as exc:
                heartbeat_error.append(exc)
                stopped.set()

    def cancelled():
        if heartbeat_error:
            raise heartbeat_error[0]
        with factory() as s:
            return require(s, QualityRun, runid).cancel_requested

    thread = Thread(target=keep_alive, daemon=True)
    thread.start()
    with (
        logger.contextualize(
            request_id=origin or str(uuid4()),
            task_id=runid,
            item_id=rrid,
            module_result_id=id,
            generation=generation,
        ),
        protected_values(original.description, original.diagnosis),
    ):
        logger.info("分支执行开始: branch={}", branch)
        try:
            context = StageContext(
                UUID(id),
                generation,
                config,
                cancelled,
                UUID(origin) if origin else None,
                heartbeat,
            )
            try:
                outcome = executor.execute(branch, original, context)
            except Cancelled:
                outcome = BranchOutcome(status="cancelled")
            except Exception as exc:
                logger.opt(exception=exc).error("分支执行失败: branch={}", branch)
                outcome = BranchOutcome(
                    status="failed",
                    error=error_from_exception(exc, "execution." + branch),
                    details=getattr(exc, "partial_details", {}),
                    evidence=getattr(exc, "partial_evidence", []),
                    stages=getattr(exc, "partial_stages", []),
                )
            if heartbeat_error:
                raise heartbeat_error[0]
            with factory.begin() as s:
                q = require(s, QualityRun, runid, True)
                m = require(s, ModuleResult, id, True)
                if m.lease_owner != owner or m.generation != generation:
                    raise fail(
                        "lease_lost", "结果未保存，租约已变化", "execution.commit"
                    )
                m.status = outcome.status
                m.finding = outcome.finding
                m.outcome = outcome.model_dump(mode="json")
                m.lease_owner = None
                m.lease_until = None
                for e in outcome.evidence:
                    s.add(
                        Evidence(
                            module_result_id=id,
                            generation=generation,
                            snapshot=e.model_dump(mode="json"),
                        )
                    )
                s.flush()
                refresh_run(s, runid)
            logger.info("分支执行结束: branch={}, status={}", branch, outcome.status)
        finally:
            stopped.set()
            thread.join(timeout=5)
