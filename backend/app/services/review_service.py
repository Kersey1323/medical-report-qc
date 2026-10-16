from sqlalchemy import select
from app.db.models import ModuleResult, ReviewDecision, RunReport, QualityRun
from app.services.common import require, stamp
from app.core.exceptions import fail


def review_dto(r):
    return {
        k: getattr(r, k)
        for k in [
            "id",
            "module_result_id",
            "generation",
            "revision",
            "type",
            "text",
            "note",
            "operator",
        ]
    } | {"created_at": stamp(r.created_at)}


def append_review(s, cmd, operator="local_operator"):
    m = require(s, ModuleResult, str(cmd.module_result_id), True)
    if cmd.generation != m.generation or cmd.expected_revision != m.review_revision:
        raise fail(
            "revision_conflict", "复核版本或执行代际已变化，请刷新", "review.append"
        )
    if m.status != "succeeded":
        raise fail(
            "input_validation_error", "仅已成功产出的建议可复核", "review.append"
        )
    m.review_revision += 1
    r = ReviewDecision(
        module_result_id=m.id,
        generation=m.generation,
        revision=m.review_revision,
        type=cmd.type,
        text=cmd.text,
        note=cmd.note,
        operator=operator,
    )
    s.add(r)
    s.flush()
    return review_dto(r)


def current_review(s, m):
    return s.scalar(
        select(ReviewDecision)
        .where(
            ReviewDecision.module_result_id == m.id,
            ReviewDecision.generation == m.generation,
        )
        .order_by(ReviewDecision.revision.desc())
        .limit(1)
    )


def pending_review(s, m):
    last = current_review(s, m)
    return (
        m.status == "succeeded"
        and m.finding in ("issue", "needs_review")
        and (not last or last.type == "defer")
    )


def last_review_type():
    return (
        select(ReviewDecision.type)
        .where(
            ReviewDecision.module_result_id == ModuleResult.id,
            ReviewDecision.generation == ModuleResult.generation,
        )
        .order_by(ReviewDecision.revision.desc())
        .limit(1)
        .correlate(ModuleResult)
        .scalar_subquery()
    )


def pending_review_condition():
    from sqlalchemy import and_, or_

    last = last_review_type()
    return and_(
        ModuleResult.status == "succeeded",
        ModuleResult.finding.in_(["issue", "needs_review"]),
        or_(last.is_(None), last == "defer"),
    )
