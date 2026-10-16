from app.schemas.dto import ReviewDTO, PageDTO
from uuid import UUID
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy import select
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.schemas.requests import ReviewCreate
from app.services.review_service import append_review, review_dto
from app.services.common import page
from app.db.models import ReviewDecision, ModuleResult, RunReport

router = APIRouter()


@router.post(
    "/reviews", status_code=201, response_model=ApiSuccess[ReviewDTO] | ApiErrorResponse
)
def create(data: ReviewCreate, request: Request, s=Depends(session, scope="function")):
    return ok(request, append_review(s, data))


@router.get(
    "/reviews", response_model=ApiSuccess[PageDTO[ReviewDTO]] | ApiErrorResponse
)
def listing(
    request: Request,
    run_id: UUID | None = None,
    module_result_id: UUID | None = None,
    type: str | None = None,
    page_number: int = Query(1, alias="page", ge=1),
    page_size: int = Query(20, ge=1, le=100),
    s=Depends(session, scope="function"),
):
    query = (
        select(ReviewDecision)
        .join(ModuleResult)
        .join(RunReport)
        .order_by(ReviewDecision.created_at, ReviewDecision.id)
    )
    if run_id:
        query = query.where(RunReport.run_id == str(run_id))
    if module_result_id:
        query = query.where(ReviewDecision.module_result_id == str(module_result_id))
    if type:
        query = query.where(ReviewDecision.type == type)
    return ok(
        request, page([review_dto(r) for r in s.scalars(query)], page_number, page_size)
    )
