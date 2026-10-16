from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import (
    String,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    JSON,
    Text,
)
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Row:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Report(Row, Base):
    __tablename__ = "reports"
    description: Mapped[str] = mapped_column(LONGTEXT)
    diagnosis: Mapped[str] = mapped_column(LONGTEXT, default="")
    extra_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    original_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_hash: Mapped[str] = mapped_column(String(64), default="")


class Import(Row, Base):
    __tablename__ = "imports"
    status: Mapped[str] = mapped_column(String(255), default="pending")
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    columns: Mapped[dict] = mapped_column(JSON, default=list)
    errors: Mapped[dict] = mapped_column(JSON, default=list)
    mapping: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    checks: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    lease_owner: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    origin_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ImportRow(Row, Base):
    __tablename__ = "import_rows"
    import_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("imports.id"), index=True
    )
    original_row: Mapped[int] = mapped_column(Integer)
    cells: Mapped[dict] = mapped_column(JSON)
    errors: Mapped[dict] = mapped_column(JSON, default=list)
    report_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("reports.id"), index=True, nullable=True
    )
    __table_args__ = (UniqueConstraint("import_id", "original_row"),)


class QualityRun(Row, Base):
    __tablename__ = "quality_runs"
    status: Mapped[str] = mapped_column(String(255), default="pending")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    checks: Mapped[dict] = mapped_column(JSON)
    config_snapshot: Mapped[dict] = mapped_column(JSON)
    config_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    import_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("imports.id"), index=True, nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    origin_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class RunReport(Row, Base):
    __tablename__ = "run_reports"
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("quality_runs.id"), index=True
    )
    report_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("reports.id"), index=True, nullable=True
    )
    import_row_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("import_rows.id"), index=True, nullable=True
    )
    original_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    invalid: Mapped[bool] = mapped_column(Boolean, default=False)
    errors: Mapped[dict] = mapped_column(JSON, default=list)


class ModuleResult(Row, Base):
    __tablename__ = "module_results"
    run_report_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("run_reports.id"), index=True
    )
    branch: Mapped[str] = mapped_column(String(255))
    generation: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(255), default="pending")
    finding: Mapped[str | None] = mapped_column(String(255), nullable=True)
    outcome: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    review_revision: Mapped[int] = mapped_column(Integer, default=0)
    lease_owner: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("run_report_id", "branch"),)


class ModuleResultVersion(Row, Base):
    __tablename__ = "module_result_versions"
    module_result_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("module_results.id"), index=True
    )
    generation: Mapped[int] = mapped_column(Integer)
    outcome: Mapped[dict] = mapped_column(JSON)
    review_revision: Mapped[int] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("module_result_id", "generation"),)


class InferenceAttempt(Row, Base):
    __tablename__ = "inference_attempts"
    module_result_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("module_results.id"), index=True
    )
    generation: Mapped[int] = mapped_column(Integer)
    stage: Mapped[str] = mapped_column(String(255))
    chunk_key: Mapped[str] = mapped_column(String(255), default="")
    attempt_no: Mapped[int] = mapped_column(Integer)
    input_hash: Mapped[str] = mapped_column(String(64))
    config_hash: Mapped[str] = mapped_column(String(64))
    remote_request_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(255), default="running")
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    identity: Mapped[dict] = mapped_column(JSON, default=dict)
    raw_response: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    reused_from_attempt_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("inference_attempts.id"), index=True, nullable=True
    )
    origin_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    __table_args__ = (
        UniqueConstraint(
            "module_result_id", "generation", "stage", "chunk_key", "attempt_no"
        ),
    )


class CscChunk(Row, Base):
    __tablename__ = "csc_chunks"
    module_result_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("module_results.id"), index=True
    )
    config_hash: Mapped[str] = mapped_column(String(64))
    chunk_key: Mapped[str] = mapped_column(String(255))
    data: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("module_result_id", "config_hash", "chunk_key"),)


class Evidence(Row, Base):
    __tablename__ = "evidence"
    module_result_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("module_results.id"), index=True
    )
    generation: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)


class CandidateCache(Row, Base):
    __tablename__ = "candidate_cache"
    cache_key: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(255), default="pending")
    lease_owner: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    __table_args__ = (UniqueConstraint("cache_key"),)


class ReviewDecision(Row, Base):
    __tablename__ = "review_decisions"
    module_result_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("module_results.id"), index=True
    )
    generation: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(255))
    text: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    operator: Mapped[str] = mapped_column(String(255), default="local_operator")
    __table_args__ = (UniqueConstraint("module_result_id", "generation", "revision"),)


class Artifact(Row, Base):
    __tablename__ = "artifacts"
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("quality_runs.id"), index=True
    )
    status: Mapped[str] = mapped_column(String(255), default="pending")
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str | None] = mapped_column(Text, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TaskOutbox(Row, Base):
    __tablename__ = "task_outbox"
    kind: Mapped[str] = mapped_column(String(255))
    target_id: Mapped[str] = mapped_column(String(36))
    generation: Mapped[int] = mapped_column(Integer, default=1)
    eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("kind", "target_id", "generation"),)


class RunCommand(Row, Base):
    __tablename__ = "run_commands"
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("quality_runs.id"), index=True
    )
    command_kind: Mapped[str] = mapped_column(String(255))
    expected_revision: Mapped[int] = mapped_column(Integer)
    targets: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("command_kind", "run_id", "expected_revision"),)
