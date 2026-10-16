from sqlalchemy import select
from app.db.models import *
from app.services.common import require, stamp
from app.services.review_service import review_dto
from app.core.exceptions import fail, sanitize


def get_result(s, id):
    m = require(s, ModuleResult, id)
    rr = require(s, RunReport, m.run_report_id)
    r = require(s, Report, rr.report_id)
    attempts = s.scalars(
        select(InferenceAttempt)
        .where(InferenceAttempt.module_result_id == id)
        .order_by(InferenceAttempt.created_at, InferenceAttempt.id)
    ).all()
    reviews = s.scalars(
        select(ReviewDecision)
        .where(ReviewDecision.module_result_id == id)
        .order_by(ReviewDecision.created_at, ReviewDecision.revision)
    ).all()
    return {
        "id": m.id,
        "run_report_id": rr.id,
        "run_id": rr.run_id,
        "branch": m.branch,
        "generation": m.generation,
        "review_revision": m.review_revision,
        "source_field": "diagnosis" if m.branch == "diagnosis" else "description",
        "source": r.diagnosis if m.branch == "diagnosis" else r.description,
        "outcome": m.outcome or {"status": m.status, "finding": None},
        "attempts": [
            {
                "id": a.id,
                "generation": a.generation,
                "stage": a.stage,
                "chunk_key": a.chunk_key,
                "attempt_no": a.attempt_no,
                "status": a.status,
                "remote_request_id": a.remote_request_id,
                "error": a.error,
                "identity": a.identity,
                "reused_from_attempt_id": a.reused_from_attempt_id,
            }
            for a in attempts
        ],
        "reviews": [review_dto(v) for v in reviews],
        "versions": [
            {"generation": v.generation, "outcome": v.outcome}
            for v in s.scalars(
                select(ModuleResultVersion).where(
                    ModuleResultVersion.module_result_id == id
                )
            )
        ],
    }


def get_evidence(s, id):
    m = require(s, ModuleResult, id)
    return [
        e.snapshot
        for e in s.scalars(
            select(Evidence)
            .where(Evidence.module_result_id == id, Evidence.generation == m.generation)
            .order_by(Evidence.created_at, Evidence.id)
        )
    ]


def raw_attempt(s, id, aid, offset=0, limit=1048576):
    require(s, ModuleResult, id)
    a = require(s, InferenceAttempt, aid)
    if a.module_result_id != id:
        raise fail("resource_not_found", "尝试不属于该结果", "audit.raw")
    data = (a.raw_response or "").encode("utf-8")
    part = data[offset : offset + min(limit, 1048576)].decode("utf-8", errors="replace")
    # Redact credentials while allowing report/model text in this explicit audit endpoint.
    return {
        "text": sanitize(part, limit=1048576),
        "offset": offset,
        "total_bytes": len(data),
        "next_offset": offset + min(limit, len(data) - offset),
    }
