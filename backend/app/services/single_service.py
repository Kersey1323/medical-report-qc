"""Connection-scoped QC: shared research pipelines, no business persistence."""
from contextlib import ExitStack
from datetime import datetime, timezone
from threading import Event
from time import monotonic
from uuid import UUID, uuid4

from app.core.exceptions import AppError, Cancelled, error_from_exception, fail, protected_values
from app.core.logging_config import logger
from app.domain.results import ReportInput, RunConfig, StageContext, StageOutput, BranchOutcome
from app.services.common import digest
from app.services import system_service


class TransientStages:
    def __init__(self, emit, cancelled):
        self.emit = emit
        self.cancelled = cancelled
        self.branch = ""

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled()

    def run(self, stage, chunk_key, input_hash, context, invoke):
        for attempt in range(1, 4):
            self.check()
            start = monotonic()
            fields = dict(branch=self.branch, stage=stage, chunk_key=chunk_key, attempt=attempt)
            self.emit("stage", **fields, state="running")
            try:
                output = invoke(uuid4(), attempt)
                self.check()
                self.emit("stage", **fields, state="succeeded", elapsed_ms=round((monotonic()-start)*1000))
                return output
            except Cancelled:
                raise
            except Exception as exc:
                detail = error_from_exception(exc, stage)
                if detail.remote_state in ("running", "queued", "unknown"):
                    detail = detail.model_copy(update={"retryable": False})
                retry = detail.retryable and attempt < 3
                self.emit("stage", **fields, state="retrying" if retry else "failed", detail=detail.model_dump(mode="json"))
                logger.warning("临时质控阶段失败: branch={}, stage={}, attempt={}, error_code={}", self.branch, stage, attempt, detail.code)
                if not retry:
                    raise AppError(detail) from exc
                if self.cancelled.wait(min(.25 * 2**(attempt-1), 2)):
                    raise Cancelled()
        raise RuntimeError("unreachable")


class TransientRetrieval:
    def __init__(self, client, stages):
        self.client, self.stages = client, stages
        self.cached = None

    def evidence(self, report, context, branch, top_k):
        from contracts.retrieval import RetrievalRequest, CandidateSet
        from retrieval_runtime.filtering import select_evidence
        from app.services.retrieval_service import RetrievalService

        if self.cached is None:
            def invoke(rid, attempt):
                result = self.client.retrieve(RetrievalRequest(
                    request_id=rid, source=report.description,
                    config_fingerprint=digest(context.config.snapshot.get("retrieval", {})),
                ))
                RetrievalService.validate_identity(result, context)
                return StageOutput(payload=result.model_dump(mode="json"))
            output = self.stages.run("retrieval", "", "", context, invoke)
            self.cached = CandidateSet.model_validate(output.payload)
        else:
            self.stages.emit("stage", branch=branch, stage="retrieval", chunk_key="", attempt=1, state="succeeded", reused=True)
        return select_evidence(self.cached, branch, top_k)


def build_transient_executor(settings, stages, stack):
    from app.clients.inference import InferenceClient
    from app.clients.online import OnlineClient
    from app.clients.retrieval import RetrievalClient
    from app.services.pipeline_executor import PipelineExecutor
    from app.pipelines.diagnosis import DiagnosisPipeline
    from app.pipelines.csc import CscPipeline
    from app.pipelines.cgec import CgecPipeline
    from app.pipelines.localization import LocalizationPipeline

    inference, online, client = InferenceClient(settings), OnlineClient(settings), RetrievalClient(settings)
    for resource in (inference.http, online.http, client.http):
        stack.callback(resource.close)
    retrieval = TransientRetrieval(client, stages)
    return PipelineExecutor({
        "diagnosis": DiagnosisPipeline(inference, online, stages),
        "csc": CscPipeline(inference, stages),
        "cgec": CgecPipeline(retrieval, online, inference, stages),
        "rag": LocalizationPipeline(retrieval, online, stages),
    })


def run_single(data, settings, request_id, publish, cancelled: Event):
    """Emit real lifecycle transitions. A failed branch never stops later branches."""
    def emit(kind, **fields):
        if cancelled.is_set():
            raise Cancelled()
        publish(dict(type=kind, at=datetime.now(timezone.utc).isoformat(), **fields))

    with protected_values(data.description, data.diagnosis), logger.contextualize(request_id=request_id, mode="single_transient"):
        try:
            emit("start", checks=data.checks)
            emit("preflight", state="running")
            snapshot = system_service.config_snapshot(settings, data.checks, {})
            ready = system_service.preflight(settings, data.checks, snapshot=snapshot)
            snapshot["preflight"] = ready
            config = RunConfig(checks=data.checks, fingerprint=digest(snapshot), snapshot=snapshot)
            emit("preflight", state="succeeded" if ready["ready"] else "failed", branches=ready["branches"])
            report = ReportInput(id=uuid4(), description=data.description, diagnosis=data.diagnosis)
            stages = TransientStages(emit, cancelled)
            outcomes = []
            with ExitStack() as stack:
                executor = build_transient_executor(settings, stages, stack)
                for branch in config.checks:
                    stages.check()
                    stages.branch = branch
                    emit("branch", branch=branch, state="running")
                    start = monotonic()
                    try:
                        readiness = ready["branches"][branch]
                        if not readiness["ready"]:
                            raise fail("preflight_failed", "；".join(r["message"] for r in readiness["reasons"]), "single.preflight", branch=branch)
                        context = StageContext(uuid4(), 1, config, cancelled.is_set, UUID(request_id), stages.check)
                        outcome = executor.execute(branch, report, context)
                    except Cancelled:
                        raise
                    except Exception as exc:
                        detail = error_from_exception(exc, "single."+branch)
                        logger.opt(exception=exc if not isinstance(exc, AppError) else None).error("临时质控分支失败: branch={}, error_code={}", branch, detail.code)
                        outcome = BranchOutcome(status="failed", error=detail,
                            details=getattr(exc, "partial_details", {}),
                            evidence=getattr(exc, "partial_evidence", []),
                            stages=getattr(exc, "partial_stages", []))
                    outcomes.append(outcome.status)
                    emit("result", branch=branch, outcome=outcome.model_dump(mode="json"), elapsed_ms=round((monotonic()-start)*1000))
            emit("complete", state="completed" if all(s=="succeeded" for s in outcomes) else "partial" if "succeeded" in outcomes else "failed")
            logger.info("临时质控结束: branches={}, succeeded={}, failed={}", len(outcomes), outcomes.count("succeeded"), outcomes.count("failed"))
        except Cancelled:
            logger.info("临时质控连接已结束，停止后续阶段")
        except Exception as exc:
            detail = error_from_exception(exc, "single.execute")
            logger.opt(exception=exc if not isinstance(exc, AppError) else None).error("临时质控失败: error_code={}", detail.code)
            if not cancelled.is_set():
                emit("error", detail=detail.model_dump(mode="json"))
