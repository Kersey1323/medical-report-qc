"""Test-only HTTP server: real MySQL/files, deterministic synthetic model executor.
Never imported by production; no environment flag enables fake production inference.
"""

import os, tempfile
from pathlib import Path
from dotenv import dotenv_values

root = Path(__file__).resolve().parents[2]
env = dotenv_values(root / ".env")
assert "/medical_qc_test_" in env["TEST_MYSQL_URL"]
os.environ["DATABASE_URL"] = env["TEST_MYSQL_URL"]
os.environ["VAR_DIR"] = tempfile.mkdtemp(prefix="medical-qc-web-test-")
os.environ["APP_LOG_DIR"] = os.environ["VAR_DIR"] + "/logs"
from app.main import create_app
from app.db.session import get_factory
from app.db.models import *
from app.services.execution_service import execute_unit
from app.services.import_service import process_import
from app.services.export_service import build_export
from app.core.config import get_settings
from app.domain.results import BranchOutcome
from app.domain.edits import diff_edits
from contracts.retrieval import Candidate, EvidenceSnapshot
from sqlalchemy import select
from threading import Thread, Event
from contextlib import asynccontextmanager
from time import sleep

factory = get_factory()


class SyntheticExecutor:
    def execute(self, branch, report, context):
        sleep(0.15)
        if "故障样本" in report.description and branch == "csc":
            return BranchOutcome(
                status="failed",
                error={
                    "code": "synthetic_failure",
                    "message": "合成故障：该条字符质控失败，其他分支继续",
                    "stage": "csc.correct",
                },
            )
        source = report.diagnosis if branch == "diagnosis" else report.description
        target = source.replace("血观束", "血管束") if branch == "csc" else source
        edits = diff_edits(source, target)
        evidence = []
        if branch in ("cgec", "rag"):
            for i in range(7):
                candidate = Candidate(
                    candidate_id=f"synthetic-{i}",
                    node_id=f"synthetic-{i}",
                    doc_id=f"合成参考报告-{i}",
                    text=f"合成参考报告 {i}：两肺纹理清晰，未见实质性病变。",
                    content_scope="report",
                    full_report_text=f"合成参考报告 {i}：两肺纹理清晰，未见实质性病变。",
                    provenance={"corpus": "test_synthetic_only", "record": i},
                    recall_rank=i + 1,
                    rerank_rank=i + 1,
                    rerank_score=0.9 - i * 0.01,
                )
                evidence.append(
                    EvidenceSnapshot(
                        id=uid(),
                        branch=branch,
                        candidate=candidate,
                        used=i < (5 if branch == "cgec" else 10),
                        used_rank=i + 1
                        if i < (5 if branch == "cgec" else 10)
                        else None,
                    )
                )
        return BranchOutcome(
            status="succeeded",
            finding="issue" if edits else "no_issue",
            spans=[{"start": e.start, "end": e.end, "text": e.before} for e in edits],
            suggestions=[e.model_dump() for e in edits],
            evidence=evidence,
            details={
                "source_field": "diagnosis" if branch == "diagnosis" else "description",
                "corrected_text": target,
            },
        )


stop = Event()


def worker():
    while not stop.wait(0.1):
        with factory() as s:
            imports = list(
                s.scalars(select(Import.id).where(Import.status == "pending"))
            )
            exports = list(
                s.scalars(select(Artifact.id).where(Artifact.status == "pending"))
            )
            units = list(
                s.scalars(
                    select(ModuleResult.id)
                    .join(RunReport)
                    .join(QualityRun, RunReport.run_id == QualityRun.id)
                    .where(
                        ModuleResult.status == "pending", QualityRun.started_at != None
                    )
                )
            )
        for id in imports:
            process_import(id, factory)
        for id in exports:
            build_export(id, factory, get_settings())
        for id in units:
            execute_unit(id, SyntheticExecutor(), factory)


app = create_app()
app.state.session_factory = factory
app.state.preflight = lambda: {
    "ready": True,
    "branches": {},
    "identities": [],
    "capacity": {},
    "model_config_fingerprint": "test-only",
}


@asynccontextmanager
async def lifespan(app):
    thread = Thread(target=worker, daemon=True)
    thread.start()
    yield
    stop.set()
    thread.join(timeout=15)


app.router.lifespan_context = lifespan
