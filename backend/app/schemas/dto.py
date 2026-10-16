from typing import Generic, TypeVar, Literal
from pydantic import BaseModel, Field
from contracts.inference import Branch, ExecutionStatus, Finding, SourceSpan
from contracts.errors import ErrorDetail
from app.domain.results import BranchOutcome


class ReportDTO(BaseModel):
    id: str
    description: str
    diagnosis: str
    extra_fields: dict
    original_row: int | None
    created_at: str


class Counts(BaseModel):
    report_total: int
    valid_rows: int
    invalid_rows: int
    units_total: int
    pending: int
    running: int
    succeeded: int
    failed: int
    cancelled: int
    reports_issue: int
    reports_needs_review: int
    reports_incomplete: int


class RunDTO(BaseModel):
    id: str
    status: Literal["pending", "running", "completed", "partial", "failed", "cancelled"]
    revision: int
    checks: list[Branch]
    config_snapshot: dict
    counts: Counts
    created_at: str
    started_at: str | None
    finished_at: str | None
    cancel_requested: bool


class UnitSummary(BaseModel):
    id: str
    branch: Branch
    status: ExecutionStatus
    finding: Finding | None
    generation: int
    review_revision: int


class RunReportDTO(BaseModel):
    id: str
    run_id: str
    report_id: str | None
    original_row: int | None
    description: str
    diagnosis: str
    extra_fields: dict
    errors: list[dict]
    invalid: bool
    results: dict[Branch, UnitSummary]
    completeness: str
    anomaly: str


class ReviewDTO(BaseModel):
    id: str
    module_result_id: str
    generation: int
    revision: int
    type: Literal["accept", "reject", "edit", "defer"]
    text: str | None
    note: str | None
    operator: str
    created_at: str


class AttemptDTO(BaseModel):
    id: str
    generation: int
    stage: str
    chunk_key: str
    attempt_no: int
    status: str
    remote_request_id: str
    error: ErrorDetail | None
    identity: dict
    reused_from_attempt_id: str | None


class ResultDTO(BaseModel):
    id: str
    run_report_id: str
    run_id: str
    branch: Branch
    generation: int
    review_revision: int
    source_field: Literal["description", "diagnosis"]
    source: str
    outcome: BranchOutcome
    attempts: list[AttemptDTO]
    reviews: list[ReviewDTO]
    versions: list[dict]


class ImportDTO(BaseModel):
    id: str
    filename: str
    status: str
    columns: list[str]
    preview_rows: list[dict]
    errors: list[dict]
    confirmed: bool
    mapping: dict | None
    checks: list[Branch] | None
    total_rows: int
    valid_rows: int
    invalid_rows: list[dict]


class ArtifactDTO(BaseModel):
    id: str
    run_id: str
    status: str
    filename: str
    sha256: str | None
    snapshot_at: str
    download_url: str | None
    error: ErrorDetail | None


T = TypeVar("T")


class PageDTO(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
