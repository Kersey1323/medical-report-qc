from datetime import timedelta
from time import sleep, monotonic
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import uuid4
from app.db.models import CandidateCache, RunReport, ModuleResult, now, uid
from app.services.common import digest, require
from contracts.retrieval import CandidateSet, RetrievalRequest
from retrieval_runtime.filtering import select_evidence
from app.core.exceptions import fail


class RetrievalService:
    def __init__(self, client, stages, factory):
        self.client = client
        self.stages = stages
        self.factory = factory

    @staticmethod
    def validate_identity(result, context):
        frozen = (
            context.config.snapshot.get("preflight", {})
            .get("capacity", {})
            .get("retrieval", {})
        )
        expected = {
            "index_fingerprint": frozen.get("index_fingerprint"),
            "embedding_fingerprint": frozen.get("embedding_fingerprint"),
            "cpu_fingerprint": frozen.get("cpu_fingerprint"),
            "reranker_fingerprint": frozen.get("reranker_fingerprint"),
            "config_fingerprint": digest(context.config.snapshot.get("retrieval", {})),
        }
        if any(
            not value or getattr(result, key) != value
            for key, value in expected.items()
        ):
            raise fail(
                "retrieval_identity_mismatch",
                "检索索引、embedding、CPU模型或运行配置身份发生变化；请核对服务并创建新任务",
                "retrieval",
            )
        if frozen.get("config_fingerprint") != expected["config_fingerprint"]:
            raise fail(
                "retrieval_identity_mismatch",
                "预检检索配置身份与任务配置不一致",
                "retrieval",
            )
        return result

    def candidates(self, report, context):
        with self.factory() as s:
            rrid = require(s, ModuleResult, str(context.module_result_id)).run_report_id
        key = digest(
            [
                rrid,
                report.description,
                context.config.snapshot.get("retrieval"),
                context.config.snapshot.get("preflight", {})
                .get("capacity", {})
                .get("retrieval"),
            ]
        )
        owner = uid()
        deadline = monotonic() + 850
        while monotonic() < deadline:
            context.heartbeat()
            if context.cancel_requested():
                from app.core.exceptions import Cancelled

                raise Cancelled()
            try:
                with self.factory.begin() as s:
                    row = s.scalar(
                        select(CandidateCache)
                        .where(CandidateCache.cache_key == key)
                        .with_for_update()
                    )
                    if row and row.status == "succeeded":
                        return self.validate_identity(
                            CandidateSet.model_validate(row.payload), context
                        )
                    if not row:
                        row = CandidateCache(
                            cache_key=key,
                            status="running",
                            lease_owner=owner,
                            lease_until=now() + timedelta(seconds=360),
                        )
                        s.add(row)
                        s.flush()
                        claimed = True
                    elif row.status != "running" or row.lease_until < now():
                        row.status = "running"
                        row.lease_owner = owner
                        row.lease_until = now() + timedelta(seconds=360)
                        claimed = True
                    else:
                        claimed = False
            except IntegrityError:
                sleep(0.1)
                continue
            if not claimed:
                sleep(0.2)
                continue
            try:
                from app.domain.results import StageOutput

                def invoke(rid, n):
                    result = self.client.retrieve(
                        RetrievalRequest(
                            request_id=rid,
                            source=report.description,
                            config_fingerprint=digest(
                                context.config.snapshot.get("retrieval", {})
                            ),
                        )
                    )
                    self.validate_identity(result, context)
                    return StageOutput(
                        payload=result.model_dump(mode="json"),
                        identity={
                            "index_fingerprint": result.index_fingerprint,
                            "embedding_fingerprint": result.embedding_fingerprint,
                            "config_fingerprint": result.config_fingerprint,
                            "cpu_fingerprint": result.cpu_fingerprint,
                            "reranker_fingerprint": result.reranker_fingerprint,
                        },
                    )

                out = self.stages.run(
                    "retrieval", "", digest([report.description, key]), context, invoke
                )
                result = self.validate_identity(
                    CandidateSet.model_validate(out.payload), context
                )
                with self.factory.begin() as s:
                    row = s.scalar(
                        select(CandidateCache)
                        .where(CandidateCache.cache_key == key)
                        .with_for_update()
                    )
                    if row.lease_owner != owner:
                        raise fail("lease_lost", "候选共享租约已变化", "retrieval")
                    row.status = "succeeded"
                    row.payload = result.model_dump(mode="json")
                    row.lease_until = None
                return result
            except Exception:
                with self.factory.begin() as s:
                    row = s.scalar(
                        select(CandidateCache)
                        .where(CandidateCache.cache_key == key)
                        .with_for_update()
                    )
                    if row.lease_owner == owner:
                        row.status = "failed"
                        row.lease_until = None
                raise
        raise fail("upstream_timeout", "等待共享检索超时", "retrieval", True)

    def evidence(self, report, context, branch, top_k):
        return select_evidence(self.candidates(report, context), branch, top_k)
