from dataclasses import asdict
from app.domain.chunks import split_source
from app.domain.edits import diff_edits, SourceEdit
from app.domain.results import BranchOutcome
from app.pipelines.common import stage_infer, edits_to_spans, apply_edits
from app.core.exceptions import AppError, Cancelled, StageValidationError
from contracts.errors import ErrorDetail


class CscPipeline:
    def __init__(self, inference, stages, chunks=None):
        self.inference = inference
        self.stages = stages
        self.chunks = chunks

    def run(self, report, context):
        chunks = split_source(report.description)
        records = []
        edits = []
        errors = []
        stages = []
        cancelled = False
        for chunk in chunks:
            if context.cancel_requested():
                cancelled = True
                break

            def validate(output):
                c = output.coverage
                if (
                    c.get("checked_chars") != len(chunk.text)
                    or c.get("source_chars") != len(chunk.text)
                    or c.get("truncated", False)
                ):
                    raise StageValidationError(
                        ErrorDetail(
                            code="coverage_incomplete",
                            message="CSC返回的覆盖范围不足",
                            stage="csc.correct",
                            retryable=True,
                        ),
                        output.raw_text,
                        output.identity,
                    )

            try:
                out = stage_infer(
                    self.stages,
                    self.inference,
                    "csc",
                    "csc.correct",
                    chunk.text,
                    context,
                    chunk_key=chunk.key,
                    validate=validate,
                )
                changes = [
                    SourceEdit(
                        e.start + chunk.start, e.end + chunk.start, e.before, e.after
                    )
                    for e in diff_edits(chunk.text, out.payload["text"])
                ]
                # One deterministic edit per original interval and replacement.
                for e in changes:
                    if e not in edits:
                        edits.append(e)
                record = {
                    "chunk": asdict(chunk),
                    "status": "succeeded",
                    "output": out.payload,
                    "edits": [asdict(e) for e in changes],
                }
                stages.append(
                    {
                        "stage": "csc.correct",
                        "chunk_key": chunk.key,
                        **out.model_dump(mode="json"),
                    }
                )
            except Cancelled:
                cancelled = True
                break
            except AppError as exc:
                errors.append(exc.detail)
                record = {
                    "chunk": asdict(chunk),
                    "status": "failed",
                    "error": exc.detail.model_dump(),
                }
            records.append(record)
            if self.chunks:
                self.chunks.save(
                    context.module_result_id, context.config.fingerprint, record
                )
        checked = [
            {"start": r["chunk"]["start"], "end": r["chunk"]["end"]}
            for r in records
            if r["status"] == "succeeded"
        ]
        donekeys = {r["chunk"]["key"] for r in records if r["status"] == "succeeded"}
        details = {
            "source_field": "description",
            "chunks": records,
            "checked_ranges": checked,
            "unchecked_ranges": [
                {"start": c.start, "end": c.end}
                for c in chunks
                if c.key not in donekeys
            ],
            "coverage_chars": sum(r["end"] - r["start"] for r in checked),
            "source_chars": len(report.description),
        }
        status = "cancelled" if cancelled else "failed" if errors else "succeeded"
        if status == "succeeded":
            details["corrected_text"] = apply_edits(report.description, edits)
        return BranchOutcome(
            status=status,
            finding=("issue" if edits else "no_issue")
            if status == "succeeded"
            else None,
            spans=edits_to_spans(edits),
            suggestions=[asdict(e) for e in edits],
            stages=stages,
            error=errors[0] if errors else None,
            details=details,
        )
