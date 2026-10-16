from concurrent.futures import ThreadPoolExecutor
from threading import Event
import pytest
from sqlalchemy import select
from tests.integration.test_schema import factory, seeded
from app.services.run_service import (
    create_run,
    start_run,
    get_run,
    retry_failed,
    cancel_run,
)
from app.services.execution_service import execute_unit, StageRunner
from app.schemas.requests import RunCreate
from app.domain.results import BranchOutcome, StageContext, RunConfig, StageOutput
from app.core.exceptions import fail, AppError
from app.db.models import ModuleResult, InferenceAttempt, QualityRun, TaskOutbox
from uuid import UUID


def test_continue_and_retry(factory, seeded):
    with factory.begin() as s:
        q = create_run(s, RunCreate(report_ids=[seeded[3]]), snapshot={})
        id = q["id"]
        start_run(s, id, {"ready": True})
        ids = s.scalars(
            select(ModuleResult.id)
            .join_from(
                ModuleResult,
                __import__("app.db.models", fromlist=["RunReport"]).RunReport,
            )
            .where(
                __import__("app.db.models", fromlist=["RunReport"]).RunReport.run_id
                == id
            )
        ).all()

    class E:
        calls = []

        def execute(self, b, r, c):
            self.calls.append(b)
            if b == "csc":
                raise fail("response_invalid", "合成故障", "csc.correct")
            return BranchOutcome(
                status="succeeded", finding="issue" if b == "diagnosis" else "no_issue"
            )

    e = E()
    for mid in ids:
        execute_unit(mid, e, factory)
    with factory.begin() as s:
        q = get_run(s, id)
        assert q["status"] == "partial" and len(e.calls) == 4
        old = q["revision"]
        retry_failed(s, id, old)
        retry_failed(s, id, old)  # idempotent retry command
        assert (
            sum(
                m.generation == 2
                for m in s.scalars(select(ModuleResult).where(ModuleResult.id.in_(ids)))
            )
            == 1
        )


def test_duplicate_delivery(factory, seeded):
    mid = seeded[2]
    with factory.begin() as s:
        q = s.get(QualityRun, seeded[0])
        q.started_at = __import__("app.db.models", fromlist=["now"]).now()
    entered = Event()
    release = Event()

    class E:
        calls = 0

        def execute(self, b, r, c):
            self.calls += 1
            entered.set()
            release.wait(5)
            return BranchOutcome(status="succeeded", finding="no_issue")

    e = E()
    with ThreadPoolExecutor(2) as pool:
        a = pool.submit(execute_unit, mid, e, factory)
        assert entered.wait(3)
        b = pool.submit(execute_unit, mid, e, factory)
        b.result(3)
        release.set()
        a.result(5)
    assert e.calls == 1


def test_stage_budget_and_reuse(factory, seeded):
    ctx = StageContext(UUID(seeded[2]), 1, RunConfig(fingerprint="x"), lambda: False)
    stages = StageRunner(factory)
    calls = []

    def valid(rid, n):
        calls.append(n)
        return StageOutput(payload={"text": "ok"}, request_id=rid)

    stages.run("diagnosis.generate", "", "input", ctx, valid)
    stages.run("diagnosis.generate", "", "input", ctx, valid)
    assert calls == [1]

    def bad(rid, n):
        calls.append(n)
        raise fail("response_invalid", "bad", "diagnosis.judge", True)

    with pytest.raises(AppError):
        stages.run("diagnosis.judge", "", "input", ctx, bad)
    assert calls == [1, 1, 2, 3]
    with pytest.raises(AppError):
        stages.run("diagnosis.judge", "", "input", ctx, bad)
    assert len(calls) == 4
