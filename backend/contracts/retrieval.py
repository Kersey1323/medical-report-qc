from uuid import UUID
from typing import Literal
from pydantic import BaseModel, Field


class RetrievalRequest(BaseModel):
    request_id: UUID
    source: str
    config_fingerprint: str
    recall_k: int = Field(default=20, ge=1, le=20)


class Candidate(BaseModel):
    candidate_id: str
    node_id: str
    doc_id: str | None = None
    text: str
    content_scope: Literal["report", "indexed_chunk"] = "indexed_chunk"
    full_report_text: str | None = None
    provenance: dict = Field(default_factory=dict)
    recall_rank: int
    recall_score: float | None = None
    rerank_rank: int | None = None
    rerank_score: float | None = None
    similarity: float | None = None
    filter_reason: str | None = None


class CandidateSet(BaseModel):
    candidates: list[Candidate]
    index_fingerprint: str
    embedding_fingerprint: str
    config_fingerprint: str
    cpu_fingerprint: str = ""
    reranker_fingerprint: str = ""


class EvidenceSnapshot(BaseModel):
    id: str
    branch: str
    candidate: Candidate
    used_rank: int | None = None
    used: bool = False
