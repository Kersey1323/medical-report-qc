from dataclasses import asdict
from app.domain.results import BranchOutcome
from app.domain.teacher import parse_teacher, TeacherResult, classify_cgec
from app.domain.spans import to_single_line, map_model_edits
from app.domain.edits import diff_edits
from app.domain.clinical_facts import detect_fact_changes
from app.pipelines.common import (
    prompt,
    stage_online,
    stage_infer,
    edits_to_spans,
    apply_edits,
    attach_partial,
)
from research_adapters.llm4cgec import make_reference_prompt
from app.core.exceptions import StageValidationError
from contracts.errors import ErrorDetail


class CgecPipeline:
    def __init__(self, retrieval, online, inference, stages):
        self.retrieval = retrieval
        self.online = online
        self.inference = inference
        self.stages = stages

    def run(self, report, context):
        view = to_single_line(report.description)
        evidence = self.retrieval.evidence(report, context, "cgec", 5)
        selected = sorted([e for e in evidence if e.used], key=lambda e: e.used_rank)
        text = prompt("cgec_teacher_rag_v1.txt").format(
            source=view.text,
            rag_context="\n\n".join(
                f"[{e.used_rank}] {e.candidate.text}" for e in selected
            ),
        )
        try:
            teacher_out = stage_online(
                self.stages,
                self.online,
                "teacher",
                "cgec.teacher",
                [
                    {"role": "system", "content": prompt("cgec_teacher_system_v1.txt")},
                    {"role": "user", "content": text},
                ],
                context,
                lambda raw: parse_teacher(raw, view.text).model_dump(),
            )
        except Exception as exc:
            attach_partial(
                exc,
                details={
                    "source_field": "description",
                    "model_view": {"text": view.text, "offset_map": view.offset_map},
                },
                evidence=evidence,
            )
            raise
        teacher = TeacherResult.model_validate(teacher_out.payload["parsed"])
        completion = make_reference_prompt(view.text, teacher.reference_correction)

        def validate(output):
            if output.stop_reason not in (
                "eos",
                "example_boundary",
                "eos_token",
                "valid_boundary",
            ):
                raise StageValidationError(
                    ErrorDetail(
                        code="student_output_incomplete",
                        message="学生输出未完整结束",
                        stage="cgec.student",
                        retryable=True,
                    ),
                    output.raw_text,
                    output.identity,
                )

        try:
            student = stage_infer(
                self.stages,
                self.inference,
                "cgec",
                "cgec.student",
                view.text,
                context,
                completion=completion,
                validate=validate,
            )
        except Exception as exc:
            attach_partial(
                exc,
                details={
                    "source_field": "description",
                    "teacher": teacher.model_dump(),
                    "model_view": {"text": view.text, "offset_map": view.offset_map},
                },
                evidence=evidence,
                stages=[
                    {"stage": "cgec.teacher", **teacher_out.model_dump(mode="json")}
                ],
            )
            raise
        target = student.payload["text"]
        mapped = map_model_edits(view, diff_edits(view.text, target))
        facts = detect_fact_changes(view.text, target) + detect_fact_changes(
            view.text, teacher.reference_correction
        )
        finding = classify_cgec(view.text, teacher, target, facts, mapped.ambiguous)
        return BranchOutcome(
            status="succeeded",
            finding=finding,
            spans=edits_to_spans(mapped.edits),
            suggestions=[asdict(e) for e in mapped.edits],
            evidence=evidence,
            stages=[
                {"stage": "cgec.teacher", **teacher_out.model_dump(mode="json")},
                {"stage": "cgec.student", **student.model_dump(mode="json")},
            ],
            details={
                "source_field": "description",
                "model_view": {"text": view.text, "offset_map": view.offset_map},
                "teacher": teacher.model_dump(),
                "student": student.payload,
                "corrected_text": apply_edits(report.description, mapped.edits),
                "mapping_ambiguous": mapped.ambiguous,
                "fact_changes": [asdict(f) for f in facts],
                "clinical_guard_limit": "风险提示不证明临床事实等价",
            },
        )
