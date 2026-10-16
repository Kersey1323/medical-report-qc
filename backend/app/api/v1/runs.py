from app.schemas.dto import RunDTO, RunReportDTO, ReportNavigationDTO, PageDTO
from uuid import UUID
from fastapi import APIRouter, Request, Depends, Query
from sqlalchemy import select, func, or_
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.schemas.requests import RunCreate, RetryCommand
from app.services import run_service as service
from app.services import system_service
from app.core.config import get_settings
from app.services.common import page, require
from app.db.models import QualityRun, Import

router = APIRouter()


@router.post(
    "/runs", status_code=201, response_model=ApiSuccess[RunDTO] | ApiErrorResponse
)
def create(data: RunCreate, request: Request, s=Depends(session, scope="function")):
    snap = system_service.config_snapshot(get_settings(), data.checks, data.profiles)
    return ok(request, service.create_run(s, data, snap, request.state.request_id))


@router.get("/runs", response_model=ApiSuccess[PageDTO[RunDTO]] | ApiErrorResponse)
def listing(
    request: Request,
    page_number: int = Query(1, alias="page", ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    q: str = Query("", max_length=200),
    order: str = Query("newest", pattern="^(newest|oldest)$"),
    s=Depends(session, scope="function"),
):
    query = select(QualityRun).outerjoin(Import, Import.id == QualityRun.import_id).order_by(
        QualityRun.created_at.asc() if order == "oldest" else QualityRun.created_at.desc(), QualityRun.id
    )
    if status:
        query = query.where(QualityRun.status == status)
    if q.strip():
        query = query.where(or_(QualityRun.id.contains(q.strip(), autoescape=True), Import.filename.contains(q.strip(), autoescape=True)))
    total = s.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    ids = list(s.scalars(query.offset((page_number - 1) * page_size).limit(page_size)))
    return ok(
        request,
        {
            "items": [service.get_run(s, r.id) for r in ids],
            "total": total,
            "page": page_number,
            "page_size": page_size,
        },
    )


@router.get("/runs/{id}", response_model=ApiSuccess[RunDTO] | ApiErrorResponse)
def get(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, service.get_run(s, str(id)))


@router.post(
    "/runs/{id}/start",
    status_code=202,
    response_model=ApiSuccess[RunDTO] | ApiErrorResponse,
)
def start(id: UUID, request: Request, s=Depends(session, scope="function")):
    q = require(s, QualityRun, id)
    if q.started_at:
        return ok(request, service.get_run(s, str(id)))
    # Preflight uses no patient text; release read transaction before network calls.
    checks = q.checks
    snapshot = q.config_snapshot
    profiles = snapshot.get("profiles", {})
    s.commit()
    probe = getattr(request.app.state, "preflight", None) or (
        lambda: system_service.preflight(
            get_settings(), checks, profiles, snapshot=snapshot
        )
    )
    ready = probe()
    # Freeze live model identity/config at start, not at an unrelated later request.
    q = require(s, QualityRun, id, True)
    if q.started_at:
        return ok(request, service.get_run(s, str(id)))
    if ready.get("ready"):
        snap = dict(q.config_snapshot)
        snap["preflight"] = ready
        q.config_snapshot = snap
        q.config_fingerprint = service.digest(snap)
    return ok(request, service.start_run(s, str(id), ready))


@router.post(
    "/runs/{id}/cancel",
    status_code=202,
    response_model=ApiSuccess[RunDTO] | ApiErrorResponse,
)
def cancel(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, service.cancel_run(s, str(id)))


@router.post(
    "/runs/{id}/retry-failed",
    status_code=202,
    response_model=ApiSuccess[RunDTO] | ApiErrorResponse,
)
def retry(
    id: UUID, data: RetryCommand, request: Request, s=Depends(session, scope="function")
):
    return ok(
        request,
        service.retry_failed(
            s, str(id), data.expected_revision, data.module_result_ids
        ),
    )


@router.get(
    "/runs/{id}/reports/{report_id}/navigation",
    response_model=ApiSuccess[ReportNavigationDTO] | ApiErrorResponse,
)
def report_navigation(id: UUID, report_id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, service.report_navigation(s, str(id), str(report_id)))


@router.get(
    "/runs/{id}/reports",
    response_model=ApiSuccess[PageDTO[RunReportDTO]] | ApiErrorResponse,
)
def report_list(
    id: UUID,
    request: Request,
    page_number: int = Query(1, alias="page", ge=1),
    page_size: int = Query(20, ge=1, le=100),
    anomaly: str | None = None,
    completeness: str | None = None,
    run_report_id: UUID | None = None,
    s=Depends(session, scope="function"),
):
    return ok(
        request,
        service.report_page(
            s, str(id), page_number, page_size, anomaly, completeness, run_report_id
        ),
    )
