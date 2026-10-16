from app.schemas.dto import ReportDTO
from uuid import UUID
from fastapi import APIRouter, Depends, Request
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.schemas.requests import ReportCreate
from app.services.report_service import create_report
from app.services.common import require, row_dict
from app.db.models import Report

router = APIRouter()


@router.post(
    "/reports", status_code=201, response_model=ApiSuccess[ReportDTO] | ApiErrorResponse
)
def create(data: ReportCreate, request: Request, s=Depends(session, scope="function")):
    return ok(request, row_dict(create_report(s, data)))


@router.get("/reports/{id}", response_model=ApiSuccess[ReportDTO] | ApiErrorResponse)
def get(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, row_dict(require(s, Report, id)))
