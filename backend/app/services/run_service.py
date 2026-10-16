from sqlalchemy import select, func, case, tuple_
from app.db.models import *
from app.domain.results import BranchOutcome
from app.domain.state import summarize_report, summarize_run
from app.services.common import require, digest, stamp
from app.core.exceptions import fail


def result_summary(m):
    return {
        "id": m.id,
        "branch": m.branch,
        "status": m.status,
        "finding": m.finding,
        "generation": m.generation,
        "review_revision": m.review_revision,
    }


def report_order():
    # Imported rows retain their file order; manual reports use stable creation order.
    return (func.coalesce(RunReport.original_row, 2147483647), RunReport.created_at, RunReport.id)


def report_navigation(s, run_id, report_id):
    require(s, QualityRun, run_id)
    row = require(s, RunReport, report_id)
    if row.run_id != run_id:
        raise fail("resource_not_found", "报告不属于当前任务", "run.navigation")
    order = report_order()
    cursor = (row.original_row if row.original_row is not None else 2147483647, row.created_at, row.id)
    valid = (RunReport.run_id == run_id, RunReport.invalid.is_(False), RunReport.report_id.is_not(None))
    next_id = s.scalar(select(RunReport.id).where(*valid, tuple_(*order) > cursor).order_by(*order).limit(1))
    previous_id = s.scalar(select(RunReport.id).where(*valid, tuple_(*order) < cursor).order_by(*(column.desc() for column in order)).limit(1))
    return {
        "previous_run_report_id": previous_id,
        "next_run_report_id": next_id,
        "position": s.scalar(select(func.count()).select_from(RunReport).where(*valid, tuple_(*order) <= cursor)),
        "total": s.scalar(select(func.count()).select_from(RunReport).where(*valid)),
    }


def report_rows(s, id, selected_ids=None):
    from sqlalchemy.orm import load_only

    query = (
        select(RunReport)
        .where(RunReport.run_id == id)
        .order_by(*report_order())
    )
    if selected_ids is not None:
        query = query.where(RunReport.id.in_(selected_ids))
    rows = s.scalars(query).all()
    q = require(s, QualityRun, id)
    out = []
    reports = {
        r.id: r
        for r in s.scalars(
            select(Report).where(
                Report.id.in_([r.report_id for r in rows if r.report_id])
            )
        )
    }
    units = {}
    for m in s.scalars(
        select(ModuleResult)
        .where(ModuleResult.run_report_id.in_([r.id for r in rows]))
        .options(
            load_only(
                ModuleResult.id,
                ModuleResult.run_report_id,
                ModuleResult.branch,
                ModuleResult.status,
                ModuleResult.finding,
                ModuleResult.generation,
                ModuleResult.review_revision,
            )
        )
    ):
        units.setdefault(m.run_report_id, []).append(m)
    for rr in rows:
        r = reports.get(rr.report_id)
        ms = units.get(rr.id, [])
        outcomes = [BranchOutcome(status=m.status, finding=m.finding) for m in ms]
        summary = summarize_report(outcomes, q.checks, rr.invalid)
        out.append(
            {
                "id": rr.id,
                "run_id": id,
                "report_id": rr.report_id,
                "original_row": rr.original_row,
                "description": r.description if r else "",
                "diagnosis": r.diagnosis if r else "",
                "extra_fields": r.extra_fields if r else {},
                "errors": rr.errors,
                "invalid": rr.invalid,
                "results": {m.branch: result_summary(m) for m in ms},
                **summary.model_dump(),
            }
        )
    return out


def report_page(
    s,
    id,
    page_number=1,
    page_size=20,
    anomaly=None,
    completeness=None,
    run_report_id=None,
):
    # Filter lightweight persisted status columns before fetching report texts. Never
    # pull model responses/evidence JSON merely to render a paginated task table.
    q = require(s, QualityRun, id)
    query = (
        select(
            RunReport.id, RunReport.invalid, ModuleResult.status, ModuleResult.finding
        )
        .outerjoin(ModuleResult, ModuleResult.run_report_id == RunReport.id)
        .where(RunReport.run_id == id)
        .order_by(*report_order())
    )
    if run_report_id:
        query = query.where(RunReport.id == str(run_report_id))
    rows = {}
    for rid, invalid, status, finding in s.execute(query):
        item = rows.setdefault(rid, {"invalid": invalid, "outcomes": []})
        if status:
            item["outcomes"].append(BranchOutcome(status=status, finding=finding))
    ids = []
    for rid, record in rows.items():
        summary = summarize_report(record["outcomes"], q.checks, record["invalid"])
        if (not anomaly or summary.anomaly == anomaly) and (
            not completeness or summary.completeness == completeness
        ):
            ids.append(rid)
    selected = ids[(page_number - 1) * page_size : page_number * page_size]
    return {
        "items": report_rows(s, id, selected),
        "total": len(ids),
        "page": page_number,
        "page_size": page_size,
    }


def counts_for(s, id):
    unit_counts = dict(
        s.execute(
            select(ModuleResult.status, func.count())
            .join(RunReport, ModuleResult.run_report_id == RunReport.id)
            .where(RunReport.run_id == id)
            .group_by(ModuleResult.status)
        ).all()
    )
    counts = {
        k: int(unit_counts.get(k, 0))
        for k in ["pending", "running", "succeeded", "failed", "cancelled"]
    }
    aggregates = s.execute(
        select(
            RunReport.id,
            RunReport.invalid,
            func.count(ModuleResult.id),
            func.sum(case((ModuleResult.status == "succeeded", 1), else_=0)),
            func.max(case((ModuleResult.finding == "issue", 1), else_=0)),
            func.max(case((ModuleResult.finding == "needs_review", 1), else_=0)),
        )
        .outerjoin(ModuleResult, ModuleResult.run_report_id == RunReport.id)
        .where(RunReport.run_id == id)
        .group_by(RunReport.id, RunReport.invalid)
    ).all()
    counts.update(
        report_total=len(aggregates),
        valid_rows=sum(not r[1] for r in aggregates),
        invalid_rows=sum(bool(r[1]) for r in aggregates),
        units_total=sum(counts.values()),
        reports_issue=sum(bool(r[4]) for r in aggregates),
        reports_needs_review=sum(not r[4] and bool(r[5]) for r in aggregates),
        reports_incomplete=sum(bool(r[1]) or r[2] != r[3] for r in aggregates),
    )
    return counts


def get_run(s, id):
    q = require(s, QualityRun, id)
    return {
        "id": q.id,
        "status": q.status,
        "revision": q.revision,
        "checks": q.checks,
        "config_snapshot": q.config_snapshot,
        "counts": counts_for(s, q.id),
        "created_at": stamp(q.created_at),
        "started_at": stamp(q.started_at),
        "finished_at": stamp(q.finished_at),
        "cancel_requested": q.cancel_requested,
        "filename": s.scalar(select(Import.filename).where(Import.id == q.import_id)) if q.import_id else None,
    }


def refresh_run(s, id):
    q = require(s, QualityRun, id, True)
    counts = counts_for(s, id)
    if q.started_at:
        q.status = summarize_run(counts, q.cancel_requested)
        q.finished_at = now() if q.status not in ("pending", "running") else None
    q.revision += 1
    s.flush()


def create_run(s, data, snapshot, request_id=None):
    if data.import_id:
        imp = require(s, Import, data.import_id, True)
        if not imp.confirmed or imp.checks != data.checks:
            raise fail(
                "import_mapping_conflict",
                "导入未确认或所选检查与确认时不同",
                "run.create",
            )
        source = s.scalars(
            select(ImportRow)
            .where(ImportRow.import_id == imp.id)
            .order_by(ImportRow.original_row)
        ).all()
        if not any(r.report_id for r in source):
            raise fail("input_validation_error", "导入没有有效报告", "run.create")
    else:
        source = [
            require(s, Report, id)
            for id in dict.fromkeys(str(i) for i in data.report_ids)
        ]
        if "diagnosis" in data.checks and any(not r.diagnosis.strip() for r in source):
            raise fail("input_validation_error", "诊断质控需要医生原诊断", "run.create")
    q = QualityRun(
        checks=data.checks,
        config_snapshot=snapshot,
        config_fingerprint=digest(snapshot),
        import_id=str(data.import_id) if data.import_id else None,
        origin_request_id=request_id,
    )
    s.add(q)
    s.flush()
    for row in source:
        is_import = isinstance(row, ImportRow)
        invalid = is_import and not row.report_id
        rr = RunReport(
            run_id=q.id,
            report_id=row.report_id if is_import else row.id,
            import_row_id=row.id if is_import else None,
            original_row=row.original_row,
            invalid=invalid,
            errors=row.errors if is_import else [],
        )
        s.add(rr)
        s.flush()
        if not invalid:
            for b in data.checks:
                m = ModuleResult(run_report_id=rr.id, branch=b)
                s.add(m)
                s.flush()
                s.add(TaskOutbox(kind="qc", target_id=m.id, eligible=False))
    s.flush()
    return get_run(s, q.id)


def start_run(s, id, preflight):
    q = require(s, QualityRun, id, True)
    if q.started_at:
        return get_run(s, id)
    if not preflight["ready"]:
        raise fail(
            "preflight_failed",
            "依赖尚未就绪；请查看运行配置中的各角色原因",
            "run.start",
            False,
            branches=preflight.get("branches", {}),
        )
    if q.cancel_requested:
        raise fail("input_validation_error", "已取消的运行不能启动", "run.start")
    q.started_at = now()
    q.status = "running"
    q.revision += 1
    ids = select(ModuleResult.id).join(RunReport).where(RunReport.run_id == id)
    for box in s.scalars(select(TaskOutbox).where(TaskOutbox.target_id.in_(ids))):
        box.eligible = True
    s.flush()
    return get_run(s, id)


def cancel_run(s, id):
    q = require(s, QualityRun, id, True)
    q.cancel_requested = True
    ids = select(ModuleResult.id).join(RunReport).where(RunReport.run_id == id)
    for m in s.scalars(
        select(ModuleResult)
        .where(ModuleResult.id.in_(ids), ModuleResult.status == "pending")
        .with_for_update()
    ):
        m.status = "cancelled"
        m.finding = None
        m.outcome = BranchOutcome(status="cancelled").model_dump(mode="json")
    for box in s.scalars(select(TaskOutbox).where(TaskOutbox.target_id.in_(ids))):
        box.eligible = False
    s.flush()
    refresh_run(s, id)
    if not q.started_at:
        q.status = "cancelled"
        q.finished_at = now()
    return get_run(s, id)


def retry_failed(s, id, expected_revision, module_result_ids=None):
    q = require(s, QualityRun, id, True)
    targets = (
        sorted(set(str(x) for x in module_result_ids))
        if module_result_ids is not None
        else []
    )
    cmd = s.scalar(
        select(RunCommand).where(
            RunCommand.run_id == id,
            RunCommand.command_kind == "retry",
            RunCommand.expected_revision == expected_revision,
        )
    )
    if cmd:
        if cmd.targets != targets:
            raise fail("revision_conflict", "相同版本的重试目标不同", "run.retry")
        return cmd.response
    if expected_revision != q.revision:
        raise fail("revision_conflict", "任务版本已变化，请刷新", "run.retry")
    ms = s.scalars(
        select(ModuleResult)
        .join(RunReport)
        .where(RunReport.run_id == id)
        .with_for_update()
    ).all()
    chosen = (
        [m for m in ms if m.id in targets]
        if module_result_ids is not None
        else [m for m in ms if m.status == "failed"]
    )
    if (
        not chosen
        or any(m.status != "failed" for m in chosen)
        or (targets and len(chosen) != len(targets))
    ):
        raise fail(
            "input_validation_error", "重试只允许选择本任务的失败分支", "run.retry"
        )
    unresolved = s.scalars(
        select(InferenceAttempt).where(
            InferenceAttempt.module_result_id.in_([m.id for m in chosen])
        )
    ).all()
    if any(
        a.status == "running"
        or (a.error or {}).get("remote_state") in ("running", "queued", "unknown")
        for a in unresolved
    ):
        raise fail(
            "remote_state_unknown",
            "存在未确认调用，等待恢复核对原请求ID后再重试",
            "run.retry",
        )
    for m in chosen:
        s.add(
            ModuleResultVersion(
                module_result_id=m.id,
                generation=m.generation,
                outcome=m.outcome or {},
                review_revision=m.review_revision,
            )
        )
        m.generation += 1
        m.review_revision = 0
        m.status = "pending"
        m.finding = None
        m.outcome = None
        m.lease_owner = None
        m.lease_until = None
        s.add(
            TaskOutbox(
                kind="qc", target_id=m.id, generation=m.generation, eligible=True
            )
        )
    q.cancel_requested = False
    q.finished_at = None
    s.flush()
    refresh_run(s, id)
    result = get_run(s, id)
    s.add(
        RunCommand(
            run_id=id,
            command_kind="retry",
            expected_revision=expected_revision,
            targets=targets,
            response=result,
        )
    )
    return result
