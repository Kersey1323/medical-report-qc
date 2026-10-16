from app.schemas.dto import ResultDTO, PageDTO
from contracts.retrieval import EvidenceSnapshot
from uuid import UUID
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy import select, func
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.services.common import page
from app.services.evidence_service import get_result, get_evidence, raw_attempt
from app.services.review_service import (
    pending_review,
    current_review,
    pending_review_condition,
    last_review_type,
)
from app.db.models import ModuleResult, RunReport

router = APIRouter()


@router.get(
    "/results", response_model=ApiSuccess[PageDTO[ResultDTO]] | ApiErrorResponse
)
def listing(
    request: Request,
    run_id: UUID | None = None,
    branch: str | None = None,
    status: str | None = None,
    review_state: str | None = None,
    page_number: int = Query(1, alias="page", ge=1),
    page_size: int = Query(20, ge=1, le=100),
    s=Depends(session, scope="function"),
):
    query = (
        select(ModuleResult.id)
        .join(RunReport)
        .order_by(ModuleResult.created_at, ModuleResult.id)
    )
    if run_id:
        query = query.where(RunReport.run_id == str(run_id))
    if branch:
        query = query.where(ModuleResult.branch == branch)
    if status:
        query = query.where(ModuleResult.status == status)
    if review_state == "pending":
        query = query.where(pending_review_condition())
    if review_state == "reviewed":
        query = query.where(last_review_type() != "defer")
    total = s.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    ids = s.scalars(query.offset((page_number - 1) * page_size).limit(page_size)).all()
    return ok(
        request,
        {
            "items": [get_result(s, id) for id in ids],
            "total": total,
            "page": page_number,
            "page_size": page_size,
        },
    )


@router.get("/results/{id}", response_model=ApiSuccess[ResultDTO] | ApiErrorResponse)
def get(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, get_result(s, str(id)))


@router.get(
    "/results/{id}/evidence",
    response_model=ApiSuccess[list[EvidenceSnapshot]] | ApiErrorResponse,
)
def evidence(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, get_evidence(s, str(id)))


@router.get(
    "/results/{id}/attempts/{attempt_id}/raw",
    response_model=ApiSuccess[dict] | ApiErrorResponse,
)
def raw(
    id: UUID,
    attempt_id: UUID,
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(1048576, ge=1, le=1048576),
    s=Depends(session, scope="function"),
):
    return ok(request, raw_attempt(s, str(id), str(attempt_id), offset, limit))
