import json
from app.domain.results import BranchOutcome
from app.domain.spans import resolve_fragment
from app.pipelines.common import prompt, stage_online, attach_partial
from app.core.exceptions import fail


def parse_localization(raw, source):
    try:
        obj = json.loads(raw)
        if (
            type(obj) is not dict
            or set(obj) != {"answer", "reason"}
            or any(
                type(obj[k]) is not str or not obj[k].strip()
                for k in ["answer", "reason"]
            )
        ):
            raise ValueError("structure")
    except (ValueError, TypeError) as exc:
        raise fail(
            "response_invalid",
            "定位返回的JSON结构、answer或reason无效",
            "rag.parse",
            True,
        ) from exc
    if obj["answer"] == "未发现错误":
        return obj | {"finding": "no_issue", "spans": [], "candidate_spans": []}
    resolved = resolve_fragment(source, obj["answer"])
    return obj | {
        "finding": "needs_review" if resolved.ambiguous else "issue",
        "spans": [s.model_dump() for s in resolved.spans],
        "candidate_spans": [s.model_dump() for s in resolved.candidate_spans],
    }


class LocalizationPipeline:
    def __init__(self, retrieval, online, stages):
        self.retrieval = retrieval
        self.online = online
        self.stages = stages

    def run(self, report, context):
        evidence = self.retrieval.evidence(report, context, "rag", 10)
        selected = sorted([e for e in evidence if e.used], key=lambda e: e.used_rank)
        context_str = "\n\n".join(
            f"[{e.used_rank}] {e.candidate.text}" for e in selected
        )
        stages = []
        answers = []
        for number, filename in [
            (1, "qcrag_error_localization_v2_audit.txt"),
            (2, "qcrag_error_localization_v2_strict_audit.txt"),
        ]:
            stage = "rag.first" if number == 1 else "rag.second"
            text = prompt(filename).format(
                context_str=context_str, query_str=report.description
            )
            try:
                out = stage_online(
                    self.stages,
                    self.online,
                    "localizer",
                    stage,
                    [{"role": "user", "content": text}],
                    context,
                    lambda raw: parse_localization(raw, report.description),
                )
            except Exception as exc:
                attach_partial(
                    exc,
                    details={
                        "source_field": "description",
                        "first": answers[0] if answers else None,
                        "trigger": "valid_no_error" if answers else None,
                        "failed_stage": stage,
                    },
                    evidence=evidence,
                    stages=stages,
                )
                raise
            answer = out.payload["parsed"]
            answers.append(answer)
            stages.append({"stage": stage, **out.model_dump(mode="json")})
            if answer["finding"] != "no_issue":
                break
        final = answers[-1]
        return BranchOutcome(
            status="succeeded",
            finding=final["finding"],
            spans=final["spans"],
            evidence=evidence,
            stages=stages,
            details={
                "source_field": "description",
                "first": answers[0],
                "second": answers[1] if len(answers) > 1 else None,
                "trigger": "valid_no_error"
                if len(answers) > 1
                else "first_found_fragment",
                "final_stage": stages[-1]["stage"],
                "candidate_spans": final["candidate_spans"],
                "reason": final["reason"],
            },
        )
