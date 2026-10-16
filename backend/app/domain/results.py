from typing import Callable
from uuid import UUID
from pydantic import BaseModel, Field, model_validator
from dataclasses import dataclass
from contracts.inference import Branch, ExecutionStatus, Finding, SourceSpan, BRANCHES
from contracts.errors import ErrorDetail
from contracts.retrieval import EvidenceSnapshot


class ReportInput(BaseModel):
    model_config = {"frozen": True}
    id: UUID
    description: str
    diagnosis: str = ""
    original_row: int | None = None
    extra_fields: dict = Field(default_factory=dict)


class RunConfig(BaseModel):
    checks: list[Branch] = Field(default_factory=lambda: list(BRANCHES))
    profiles: dict[str, str] = Field(default_factory=dict)
    fingerprint: str = ""
    snapshot: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def selected(self):
        if not self.checks:
            raise ValueError("至少选择一项检查")
        self.checks = [b for b in BRANCHES if b in self.checks]
        return self


class BranchOutcome(BaseModel):
    status: ExecutionStatus
    finding: Finding | None = None
    spans: list[SourceSpan] = Field(default_factory=list)
    suggestions: list[dict] = Field(default_factory=list)
    evidence: list[EvidenceSnapshot] = Field(default_factory=list)
    stages: list[dict] = Field(default_factory=list)
    error: ErrorDetail | None = None
    details: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def coherent(self):
        if self.status != "succeeded" and self.finding is not None:
            raise ValueError("未成功不能给出结论")
        if self.status == "succeeded" and self.finding is None:
            raise ValueError("成功必须有结论")
        return self


@dataclass(frozen=True)
class StageContext:
    module_result_id: UUID
    generation: int
    config: RunConfig
    cancel_requested: Callable[[], bool]
    request_id: UUID | None = None
    heartbeat: Callable[[], None] = lambda: None


class StageOutput(BaseModel):
    payload: dict
    identity: dict = Field(default_factory=dict)
    request_id: UUID | None = None
