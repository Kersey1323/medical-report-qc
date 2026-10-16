from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator
from contracts.errors import ErrorDetail

Branch = Literal["diagnosis", "csc", "cgec", "rag"]
ExecutionStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]
Finding = Literal["no_issue", "issue", "needs_review"]
BRANCHES = ["diagnosis", "csc", "cgec", "rag"]


class SourceSpan(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str

    @model_validator(mode="after")
    def bounds(self):
        if self.end < self.start or len(self.text) != self.end - self.start:
            raise ValueError("Invalid code point span")
        return self


class ModelIdentity(BaseModel):
    role: str
    path_or_model: str
    revision: str | None = None
    tokenizer_hash: str | None = None
    adapter_hash: str | None = None
    source_hashes: dict[str, str] = Field(default_factory=dict)
    model_config = {"extra": "allow"}


class InferenceRequest(BaseModel):
    request_id: UUID
    role: Literal["diagnosis", "csc", "cgec"]
    source: str
    prompt: str | None = None
    config_fingerprint: str
    parameters: dict = Field(default_factory=dict)
    deadline_at: datetime


class InferenceOutput(BaseModel):
    request_id: UUID
    text: str
    raw_text: str
    identity: dict
    input_tokens: int | None = None
    output_tokens: int | None = None
    stop_reason: str | None = None
    coverage: dict = Field(default_factory=dict)
    elapsed_ms: float = 0


class RequestState(BaseModel):
    request_id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "cancelled", "unknown"]
    output: InferenceOutput | None = None
    error: ErrorDetail | None = None
    model_config = {"extra": "ignore"}
