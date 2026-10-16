import json, re
from typing import Literal
from pydantic import BaseModel, StrictBool, Field, ValidationError
from app.core.exceptions import StageValidationError
from contracts.errors import ErrorDetail


class TeacherResult(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    has_error: StrictBool
    error_type: Literal[
        "word_order",
        "redundant_component",
        "mixed_structure",
        "missing_component",
        "connective_error",
        "negation_structure",
        "no_error",
    ]
    reference_correction: str = Field(min_length=1)
    explanation: str = Field(min_length=1)


def parse_teacher(raw, source):
    try:
        t = TeacherResult.model_validate(json.loads(raw))
        if not t.reference_correction.strip() or not t.explanation.strip():
            raise ValueError("empty")
        changed = re.sub(r"\s", "", t.reference_correction) != re.sub(r"\s", "", source)
        if not t.has_error and (
            t.error_type != "no_error" or t.reference_correction != source
        ):
            raise ValueError("contradiction")
        if t.has_error and (t.error_type == "no_error" or not changed):
            raise ValueError("contradiction")
        return t
    except (ValueError, TypeError, ValidationError) as exc:
        raise StageValidationError(
            ErrorDetail(
                code="response_invalid",
                message="教师JSON类型、错误类别或参考修正语义不一致",
                stage="cgec.teacher",
                retryable=True,
            ),
            raw_response=raw,
        ) from exc


def classify_cgec(source, teacher, student, fact_changes, mapping_ambiguous):
    if fact_changes or mapping_ambiguous:
        return "needs_review"
    clean = lambda t: re.sub(r"\s", "", t)
    if not teacher.has_error and clean(student) == clean(source):
        return "no_issue"
    if (
        teacher.has_error
        and clean(student) != clean(source)
        and clean(student) == clean(teacher.reference_correction)
    ):
        return "issue"
    return "needs_review"
