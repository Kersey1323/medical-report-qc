from types import SimpleNamespace
from uuid import UUID
import pytest
from sqlalchemy import select
from tests.integration.test_schema import factory, seeded
from app.db.models import CandidateCache
from app.domain.results import StageContext, RunConfig, ReportInput
from app.services.execution_service import StageRunner
from app.services.retrieval_service import RetrievalService
from app.services.common import digest
from app.core.exceptions import AppError
from contracts.retrieval import CandidateSet


@pytest.mark.parametrize(
    "changed",
    [
        "index_fingerprint",
        "embedding_fingerprint",
        "config_fingerprint",
        "cpu_fingerprint",
        "reranker_fingerprint",
    ],
)
def test_retrieval_rejects_drift_before_success_or_cache(factory, seeded, changed):
    cfg = {"test": seeded[0]}
    identity = {
        "index_fingerprint": "OLD-I",
        "embedding_fingerprint": "OLD-E",
        "config_fingerprint": digest(cfg),
        "cpu_fingerprint": "OLD-CPU",
        "reranker_fingerprint": "OLD-RERANKER",
    }
    actual = {**identity, changed: "NEW"}
    result = CandidateSet(candidates=[], **actual)
    ctx = StageContext(
        UUID(seeded[2]),
        1,
        RunConfig(
            fingerprint="x",
            snapshot={
                "retrieval": cfg,
                "preflight": {"capacity": {"retrieval": identity}},
            },
        ),
        lambda: False,
    )
    svc = RetrievalService(
        SimpleNamespace(retrieve=lambda req: result), StageRunner(factory), factory
    )
    with pytest.raises(AppError, match="身份|配置|变化"):
        svc.candidates(ReportInput(id=seeded[3], description="合成查询"), ctx)
    rrid = seeded[1]
    cache_key = digest([rrid, "合成查询", cfg, identity])
    with factory() as s:
        rows = s.scalars(
            select(CandidateCache).where(
                CandidateCache.cache_key == cache_key,
                CandidateCache.status == "succeeded",
            )
        ).all()
        assert not any(r.payload and r.payload.get(changed) == "NEW" for r in rows)
