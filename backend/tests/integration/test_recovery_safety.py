from tests.integration.test_schema import factory, seeded
from app.db.models import *
from app.tasks.recovery import recover_once
from app.services.execution_service import StageRunner
from app.domain.results import StageContext, RunConfig, StageOutput
from contracts.inference import RequestState
from datetime import timedelta
from uuid import UUID
from sqlalchemy import select


def test_running_remote_not_requeued(factory, seeded, monkeypatch):
    monkeypatch.setattr(
        "app.tasks.recovery.publish_outbox", lambda *a, **k: {"published": 0}
    )
    with factory.begin() as s:
        m = s.get(ModuleResult, seeded[2])
        m.status = "running"
        m.lease_until = now() - timedelta(seconds=10)
        a = InferenceAttempt(
            module_result_id=m.id,
            generation=1,
            stage="csc.correct",
            chunk_key="c",
            attempt_no=1,
            input_hash="input",
            config_hash="x",
            remote_request_id=uid(),
        )
        s.add(a)
        s.flush()
        rid = a.remote_request_id
    recover_once(factory, lambda rid: RequestState(request_id=rid, status="running"))
    with factory() as s:
        m = s.get(ModuleResult, seeded[2])
        assert m.status == "running" and m.lease_until > now()


def test_resumable_uses_original_attempt(factory, seeded):
    with factory.begin() as s:
        a = InferenceAttempt(
            module_result_id=seeded[2],
            generation=1,
            stage="csc.correct",
            chunk_key="c",
            attempt_no=1,
            input_hash="input",
            config_hash="x",
            remote_request_id=uid(),
            status="resumable",
        )
        s.add(a)
        s.flush()
        rid = a.remote_request_id
    calls = []

    def invoke(id, n):
        calls.append((str(id), n))
        return StageOutput(payload={"text": "完成"}, request_id=id)

    ctx = StageContext(UUID(seeded[2]), 1, RunConfig(fingerprint="x"), lambda: False)
    StageRunner(factory).run("csc.correct", "c", "input", ctx, invoke)
    assert calls == [(rid, 1)]
    with factory() as s:
        assert (
            s.scalar(
                select(__import__("sqlalchemy").func.count())
                .select_from(InferenceAttempt)
                .where(InferenceAttempt.module_result_id == seeded[2])
            )
            == 1
        )


import pytest


@pytest.mark.parametrize("remote_status", ["running", "unknown", "succeeded"])
def test_recovery_never_overwrites_worker_that_completed_during_lookup(
    factory, seeded, monkeypatch, remote_status
):
    monkeypatch.setattr(
        "app.tasks.recovery.publish_outbox", lambda *a, **k: {"published": 0}
    )
    with factory.begin() as s:
        m = s.get(ModuleResult, seeded[2])
        m.status = "running"
        m.lease_owner = "old-worker"
        m.lease_until = now() - timedelta(seconds=10)
        s.add(
            InferenceAttempt(
                module_result_id=m.id,
                generation=1,
                stage="csc.correct",
                chunk_key="c",
                attempt_no=1,
                input_hash="input",
                config_hash="x",
                remote_request_id=uid(),
            )
        )

    def lookup(rid):
        with factory.begin() as s:
            m = s.get(ModuleResult, seeded[2])
            m.status = "succeeded"
            m.finding = "no_issue"
            m.lease_owner = None
            m.lease_until = None
        return RequestState(request_id=rid, status=remote_status)

    recover_once(factory, lookup)
    with factory() as s:
        m = s.get(ModuleResult, seeded[2])
        assert (
            m.status == "succeeded"
            and m.finding == "no_issue"
            and m.lease_until is None
        )


def test_lock_refreshes_previously_read_identity(factory, seeded):
    from app.services.common import require

    with factory() as first:
        cached = require(first, ModuleResult, seeded[2])
        assert cached.status == "pending"
        with factory.begin() as second:
            second.get(ModuleResult, seeded[2]).status = "succeeded"
        locked = require(first, ModuleResult, seeded[2], True)
        assert locked.status == "succeeded"


def test_uncertain_previous_generation_cannot_submit_new_remote_id(factory, seeded):
    from app.core.exceptions import AppError

    with factory.begin() as s:
        s.add(
            InferenceAttempt(
                module_result_id=seeded[2],
                generation=1,
                stage="csc.correct",
                chunk_key="c",
                attempt_no=1,
                input_hash="input",
                config_hash="x",
                remote_request_id=uid(),
                status="failed",
                error={
                    "code": "upstream_timeout",
                    "message": "still running",
                    "stage": "csc.correct",
                    "retryable": False,
                    "remote_state": "running",
                },
            )
        )
    calls = []
    ctx = StageContext(UUID(seeded[2]), 2, RunConfig(fingerprint="x"), lambda: False)
    with pytest.raises(AppError):
        StageRunner(factory).run(
            "csc.correct", "c", "input", ctx, lambda rid, n: calls.append(rid)
        )
    assert calls == []
