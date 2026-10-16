from sqlalchemy import select, func
from app.db.models import ModuleResult, ReviewDecision, RunReport, QualityRun, Import
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


def review_tasks(s, page_number=1, page_size=20):
    """Aggregate the current pending queue in SQL before paginating tasks."""
    pending = (
        select(
            RunReport.run_id.label("run_id"),
            func.count(func.distinct(RunReport.id)).label("pending_reports"),
            func.count(ModuleResult.id).label("pending_results"),
        )
        .join(ModuleResult, ModuleResult.run_report_id == RunReport.id)
        .where(pending_review_condition())
        .group_by(RunReport.run_id)
        .subquery()
    )
    reports = (
        select(RunReport.run_id, func.count(RunReport.id).label("report_total"))
        .group_by(RunReport.run_id)
        .subquery()
    )
    query = (
        select(
            QualityRun.id.label("run_id"),
            QualityRun.created_at,
            QualityRun.status,
            Import.filename,
            reports.c.report_total,
            pending.c.pending_reports,
            pending.c.pending_results,
        )
        .join(pending, pending.c.run_id == QualityRun.id)
        .join(reports, reports.c.run_id == QualityRun.id)
        .outerjoin(Import, Import.id == QualityRun.import_id)
        .order_by(QualityRun.created_at.desc(), QualityRun.id)
    )
    total = s.scalar(select(func.count()).select_from(pending))
    rows = s.execute(query.offset((page_number - 1) * page_size).limit(page_size)).mappings()
    return {
        "items": [dict(row) | {"created_at": stamp(row["created_at"])} for row in rows],
        "total": total,
        "page": page_number,
        "page_size": page_size,
    }


def review_reports(s, run_id, page_number=1, page_size=20, review_state="pending"):
    """Paginate reports, not suggestions; multiple pending branches share one row."""
    from app.services.run_service import report_order, report_rows

    require(s, QualityRun, run_id)
    pending = (
        select(ModuleResult.run_report_id, func.count().label("pending_results"))
        .join(RunReport, RunReport.id == ModuleResult.run_report_id)
        .where(RunReport.run_id == run_id, pending_review_condition())
        .group_by(ModuleResult.run_report_id)
        .subquery()
    )
    query = (
        select(RunReport.id)
        .outerjoin(pending, pending.c.run_report_id == RunReport.id)
        .where(
            RunReport.run_id == run_id,
            RunReport.invalid.is_(False),
            RunReport.report_id.is_not(None),
        )
    )
    if review_state == "pending":
        query = query.where(pending.c.pending_results > 0)
    total = s.scalar(select(func.count()).select_from(query.subquery()))
    ids = list(s.scalars(query.order_by(*report_order()).offset((page_number - 1) * page_size).limit(page_size)))
    branches = {}
    if ids:
        for rid, branch in s.execute(
            select(ModuleResult.run_report_id, ModuleResult.branch)
            .where(ModuleResult.run_report_id.in_(ids), pending_review_condition())
        ):
            branches.setdefault(rid, []).append(branch)
    order = ("diagnosis", "csc", "cgec", "rag")
    items = []
    for report in report_rows(s, run_id, ids):
        pending_branches = [branch for branch in order if branch in branches.get(report["id"], [])]
        items.append(report | {"pending_results": len(pending_branches), "pending_branches": pending_branches})
    return {"items": items, "total": total, "page": page_number, "page_size": page_size}
