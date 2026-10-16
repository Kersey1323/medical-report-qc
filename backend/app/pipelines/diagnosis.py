from app.domain.results import BranchOutcome
from app.domain.spans import resolve_fragment
from app.pipelines.common import prompt, stage_infer, stage_online, attach_partial
from app.core.exceptions import fail


def parse_diagnosis_answer(raw, diagnosis):
    answer = raw.strip()
    if answer == "未发现错误":
        return {
            "finding": "no_issue",
            "spans": [],
            "candidate_spans": [],
            "answer": answer,
            "reason": None,
        }
    if not answer or "\n" in answer:
        raise fail(
            "response_invalid", "诊断判别未遵循片段协议", "diagnosis.judge", True
        )
    resolved = resolve_fragment(diagnosis, answer)
    return {
        "finding": "needs_review" if resolved.ambiguous else "issue",
        "spans": [s.model_dump() for s in resolved.spans],
        "candidate_spans": [s.model_dump() for s in resolved.candidate_spans],
        "answer": answer,
        "reason": None,
    }


class DiagnosisPipeline:
    def __init__(self, inference, online, stages):
        self.inference = inference
        self.online = online
        self.stages = stages

    def run(self, report, context):
        if not report.diagnosis.strip():
            raise fail("input_validation_error", "诊断质控需要医生原诊断", "diagnosis")
        generated = stage_infer(
            self.stages,
            self.inference,
            "diagnosis",
            "diagnosis.generate",
            report.description,
            context,
        )
        reference = generated.payload["text"]
        text = prompt("diagnosis_qc_localize_v2.txt").format(
            report_text=report.description,
            reference_diagnosis=reference,
            reported_diagnosis=report.diagnosis,
        )
        try:
            judged = stage_online(
                self.stages,
                self.online,
                "judge",
                "diagnosis.judge",
                [{"role": "user", "content": text}],
                context,
                lambda raw: parse_diagnosis_answer(raw, report.diagnosis),
            )
        except Exception as exc:
            attach_partial(
                exc,
                details={"source_field": "diagnosis", "reference_diagnosis": reference},
                stages=[
                    {"stage": "diagnosis.generate", **generated.model_dump(mode="json")}
                ],
            )
            raise
        answer = judged.payload["parsed"]
        return BranchOutcome(
            status="succeeded",
            finding=answer["finding"],
            spans=answer["spans"],
            details={
                "source_field": "diagnosis",
                "reference_diagnosis": reference,
                **answer,
            },
            stages=[
                {"stage": "diagnosis.generate", **generated.model_dump(mode="json")},
                {"stage": "diagnosis.judge", **judged.model_dump(mode="json")},
            ],
        )
