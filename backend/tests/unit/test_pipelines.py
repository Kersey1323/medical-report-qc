from dataclasses import asdict
from uuid import uuid4
from datetime import datetime, timezone
import pytest, json
from contracts.inference import InferenceOutput
from contracts.retrieval import Candidate, CandidateSet
from app.domain.results import ReportInput, RunConfig, StageContext, StageOutput
from app.domain.teacher import parse_teacher, classify_cgec
from app.pipelines.diagnosis import DiagnosisPipeline
from app.pipelines.csc import CscPipeline
from app.pipelines.cgec import CgecPipeline
from app.pipelines.localization import LocalizationPipeline
from app.core.exceptions import AppError
from retrieval_runtime.filtering import select_evidence


class Stages:
    def __init__(self):
        self.calls = []

    def run(self, stage, chunk_key, input_hash, context, invoke):
        self.calls.append(stage)
        return invoke(uuid4(), 1)


class Infer:
    def __init__(self, text=None):
        self.calls = []
        self.text = text

    def wait(self, r, heartbeat, trace_id=None):
        self.calls.append(r)
        return InferenceOutput(
            request_id=r.request_id,
            text=self.text or r.source,
            raw_text=self.text or r.source,
            identity={"role": r.role},
            stop_reason="eos",
            coverage={"checked_chars": len(r.source), "source_chars": len(r.source)},
        )


class Online:
    def __init__(self, answers):
        self.answers = iter(answers)
        self.calls = []

    def invoke(self, role, messages, request_id, config):
        self.calls.append((role, messages))
        from app.clients.online import OnlineResponse

        return OnlineResponse(
            next(self.answers),
            "response",
            "provider",
            "model",
            "responses",
            {},
            0,
            "completed",
        )


class Retrieval:
    def evidence(self, report, context, branch, top_k):
        cs = CandidateSet(
            candidates=[
                Candidate(
                    candidate_id=str(i),
                    node_id=str(i),
                    text="参考报告" + str(i),
                    recall_rank=i + 1,
                )
                for i in range(12)
            ],
            index_fingerprint="i",
            embedding_fingerprint="e",
            config_fingerprint="c",
        )
        return select_evidence(cs, branch, top_k)


@pytest.fixture
def report():
    return ReportInput(id=uuid4(), description="两肺纹理清晰。", diagnosis="未见异常。")


@pytest.fixture
def ctx():
    return StageContext(
        uuid4(),
        1,
        RunConfig(
            fingerprint="a",
            snapshot={
                "preflight": {"model_config_fingerprint": "gpu"},
                "online_roles": {
                    r: {"model": "m"} for r in ["judge", "teacher", "localizer"]
                },
            },
        ),
        lambda: False,
    )


def test_diagnosis_not_diff_judge(report, ctx):
    online = Online(["未发现错误"])
    out = DiagnosisPipeline(Infer("另一参考诊断"), online, Stages()).run(report, ctx)
    assert out.finding == "no_issue"
    prompt = online.calls[0][1][0]["content"]
    assert all(
        t in prompt for t in [report.description, report.diagnosis, "另一参考诊断"]
    )


def test_csc_tail_covered(ctx):
    report = ReportInput(id=uuid4(), description="甲" * 129, diagnosis="乙")
    i = Infer()
    o = CscPipeline(i, Stages()).run(report, ctx)
    assert [len(r.source) for r in i.calls] == [128, 1] and o.finding == "no_issue"


@pytest.mark.parametrize(
    "obj",
    [
        {
            "has_error": "false",
            "error_type": "no_error",
            "reference_correction": "甲",
            "explanation": "无错",
        },
        {
            "has_error": False,
            "error_type": "no_error",
            "reference_correction": "乙",
            "explanation": "无错",
        },
        {
            "has_error": True,
            "error_type": "no_error",
            "reference_correction": "乙",
            "explanation": "改",
        },
    ],
)
def test_bad_teacher(obj):
    with pytest.raises(AppError):
        parse_teacher(json.dumps(obj), "甲")


def test_teacher_normal_still_student(report, ctx):
    teacher = {
        "has_error": False,
        "error_type": "no_error",
        "reference_correction": report.description,
        "explanation": "无明显语法错误",
    }
    i = Infer()
    o = CgecPipeline(Retrieval(), Online([json.dumps(teacher)]), i, Stages()).run(
        report, ctx
    )
    assert len(i.calls) == 1 and o.finding == "no_issue"
    assert (
        "参考报告0" not in i.calls[0].prompt and "explanation" not in i.calls[0].prompt
    )


def test_localization_conditional_second(report, ctx):
    online = Online(
        [
            json.dumps({"answer": "未发现错误", "reason": "正常"}),
            json.dumps({"answer": "纹理", "reason": "合成提示"}),
        ]
    )
    out = LocalizationPipeline(Retrieval(), online, Stages()).run(report, ctx)
    assert len(online.calls) == 2 and out.finding == "issue"


def test_bad_first_does_not_trigger_second(report, ctx):
    online = Online(["not json"])
    stages = Stages()
    with pytest.raises(AppError):
        LocalizationPipeline(Retrieval(), online, stages).run(report, ctx)
    assert stages.calls == ["rag.first"]


def test_student_failure_keeps_teacher_evidence(report, ctx):
    teacher = {
        "has_error": False,
        "error_type": "no_error",
        "reference_correction": report.description,
        "explanation": "无错",
    }

    class Broken(Infer):
        def wait(self, *a, **k):
            from app.core.exceptions import fail

            raise fail("student_output_incomplete", "学生未完成", "cgec.student", True)

    with pytest.raises(AppError) as err:
        CgecPipeline(
            Retrieval(), Online([json.dumps(teacher)]), Broken(), Stages()
        ).run(report, ctx)
    assert err.value.partial_details["teacher"] == teacher
    assert sum(e.used for e in err.value.partial_evidence) == 5
