from pathlib import Path
import hashlib, os, json
from datetime import timedelta
from sqlalchemy import select
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from app.db.models import *
from app.services.common import require, stamp
from app.services.run_service import get_run, report_rows
from app.services.evidence_service import get_result
from app.core.exceptions import error_from_exception

SHEETS = [
    "报告汇总",
    "诊断质控",
    "字符纠错",
    "语法纠错",
    "片段定位",
    "失败记录",
    "处理汇总",
]


def artifact_dto(a):
    return {
        "id": a.id,
        "run_id": a.run_id,
        "status": a.status,
        "filename": a.filename,
        "sha256": a.sha256,
        "snapshot_at": stamp(a.snapshot_at),
        "download_url": f"/api/v1/exports/{a.id}/download"
        if a.status == "ready"
        else None,
        "error": a.error,
    }


def request_export(s, run_id):
    run = get_run(s, run_id)
    reports = report_rows(s, run_id)
    # Invalid rows have no Report entity; preserve their original source cells too.
    invalid_cells = {
        rr.id: row.cells
        for rr, row in s.execute(
            select(RunReport, ImportRow)
            .join(ImportRow, RunReport.import_row_id == ImportRow.id)
            .where(RunReport.run_id == run_id, RunReport.invalid == True)
        )
    }
    for report in reports:
        if report["id"] in invalid_cells:
            report["extra_fields"] = invalid_cells[report["id"]]
    results = [get_result(s, m["id"]) for r in reports for m in r["results"].values()]
    a = Artifact(
        run_id=run_id,
        filename=f"医学质控_{run_id[:8]}.xlsx",
        snapshot={"run": run, "reports": reports, "results": results},
    )
    s.add(a)
    s.flush()
    s.add(TaskOutbox(kind="export", target_id=a.id, eligible=True))
    return artifact_dto(a)


def literal_append(ws, values):
    cells = []
    for v in values:
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False)
        c = WriteOnlyCell(ws, value=str(v) if v is not None else "")
        c.data_type = "s"
        cells.append(c)
    ws.append(cells)


def long_rows(ws, values):
    # Every external column is literal text; split all large cells without loss.
    vals = [
        json.dumps(v, ensure_ascii=False)
        if isinstance(v, (dict, list))
        else str(v)
        if v is not None
        else ""
        for v in values
    ]
    count = max((len(v) + 31999) // 32000 for v in vals) if vals else 1
    for part in range(max(count, 1)):
        literal_append(
            ws, [part + 1] + [v[part * 32000 : (part + 1) * 32000] for v in vals]
        )


def build_export(id, factory, settings):
    from app.services.job_lease import RenewingLease

    owner = uid()
    lease = RenewingLease(factory, Artifact, id, owner)
    with factory.begin() as s:
        a = require(s, Artifact, id, True)
        if a.status == "ready":
            return Path(a.path)
        if a.lease_until and a.lease_until > now():
            return None
        a.status = "running"
        a.lease_owner = owner
        a.lease_until = now() + timedelta(seconds=120)
        snapshot = a.snapshot
        filename = a.filename
    with lease:
        temp = None
        w = None
        try:
            directory = settings.var_dir / "exports"
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            temp = directory / (id + "." + owner + ".tmp.xlsx")
            path = directory / (id + ".xlsx")
            w = Workbook(write_only=True)
            sheets = {n: w.create_sheet(n) for n in SHEETS}
            literal_append(
                sheets[SHEETS[0]],
                [
                    "分段",
                    "报告ID",
                    "原始行号",
                    "原始描述",
                    "原始附加字段",
                    "医生诊断",
                    "完整性",
                    "异常",
                    "错误",
                ],
            )
            for r in snapshot["reports"]:
                long_rows(
                    sheets[SHEETS[0]],
                    [
                        r["report_id"],
                        r["original_row"],
                        r["description"],
                        r.get("extra_fields", {}),
                        r["diagnosis"],
                        r["completeness"],
                        r["anomaly"],
                        r["errors"],
                    ],
                )
            literal_append(
                sheets["失败记录"],
                [
                    "分段",
                    "结果ID",
                    "报告ID",
                    "原始行号",
                    "分支",
                    "代际",
                    "状态",
                    "阶段",
                    "尝试总数",
                    "分阶段尝试",
                    "错误",
                ],
            )
            reports_by_id = {r["id"]: r for r in snapshot["reports"]}
            for report in snapshot["reports"]:
                if report.get("invalid"):
                    long_rows(
                        sheets["失败记录"],
                        [
                            "",
                            report.get("report_id"),
                            report.get("original_row"),
                            "import",
                            "",
                            "invalid",
                            "import",
                            0,
                            {},
                            report.get("errors", []),
                        ],
                    )
            for branch, name in zip(["diagnosis", "csc", "cgec", "rag"], SHEETS[1:5]):
                literal_append(
                    sheets[name],
                    [
                        "分段",
                        "结果ID",
                        "报告ID",
                        "代际",
                        "状态",
                        "结论",
                        "原文",
                        "建议",
                        "详情",
                        "人工意见",
                    ],
                )
                for r in snapshot["results"]:
                    if r["branch"] != branch:
                        continue
                    o = r["outcome"]
                    long_rows(
                        sheets[name],
                        [
                            r["id"],
                            reports_by_id[r["run_report_id"]].get("report_id"),
                            r["generation"],
                            o["status"],
                            o.get("finding"),
                            r["source"],
                            o.get("suggestions", []),
                            o.get("details", {}),
                            r["reviews"],
                        ],
                    )
                    if o["status"] in ("failed", "cancelled"):
                        report = reports_by_id[r["run_report_id"]]
                        attempts = [
                            a
                            for a in r.get("attempts", [])
                            if a["generation"] == r["generation"]
                        ]
                        stage_counts = {}
                        for a in attempts:
                            if not a.get("reused_from_attempt_id"):
                                stage_counts[a["stage"]] = (
                                    stage_counts.get(a["stage"], 0) + 1
                                )
                        long_rows(
                            sheets["失败记录"],
                            [
                                r["id"],
                                report.get("report_id"),
                                report.get("original_row"),
                                branch,
                                r["generation"],
                                o["status"],
                                (o.get("error") or {}).get("stage"),
                                sum(stage_counts.values()),
                                stage_counts,
                                o.get("error"),
                            ],
                        )
            long_rows(sheets["处理汇总"], [snapshot["run"]])
            w.save(temp)
            temp.chmod(0o600)
            sha = hashlib.sha256(temp.read_bytes()).hexdigest()
            with factory.begin() as s:
                a = require(s, Artifact, id, True)
                if not lease.owns(a):
                    return Path(a.path) if a.status == "ready" else None
                os.replace(temp, path)
                a.path = str(path)
                a.sha256 = sha
                a.status = "ready"
                a.error = None
                a.lease_until = None
                a.lease_owner = None
            return path
        except Exception as exc:
            with factory.begin() as s:
                a = require(s, Artifact, id, True)
                if not lease.owns(a):
                    return Path(a.path) if a.status == "ready" else None
                a.status = "failed"
                a.lease_owner = None
                a.error = error_from_exception(exc, "export.build").model_dump()
                a.lease_until = None
            raise
        finally:
            if w is not None:
                for sheet in w.worksheets:
                    if not sheet.closed:
                        sheet.close()
                w.close()
            if temp is not None:
                temp.unlink(missing_ok=True)
