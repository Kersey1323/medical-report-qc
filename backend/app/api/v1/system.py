from fastapi import APIRouter, Request, Depends
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.schemas.requests import Checks
from app.services import system_service as service
from app.core.config import get_settings
from contracts.inference import BRANCHES

router = APIRouter()


@router.get("/system/summary", response_model=ApiSuccess[dict] | ApiErrorResponse)
def summary(request: Request, s=Depends(session, scope="function")):
    return ok(request, service.summary(s))


@router.get("/system/config", response_model=ApiSuccess[dict] | ApiErrorResponse)
def config(request: Request):
    return ok(request, service.config_snapshot(get_settings(), BRANCHES, {}))


@router.get("/system/status", response_model=ApiSuccess[dict] | ApiErrorResponse)
def status(request: Request):
    return ok(request, service.preflight(get_settings(), BRANCHES))


@router.post("/system/preflight", response_model=ApiSuccess[dict] | ApiErrorResponse)
def preflight(data: Checks, request: Request):
    return ok(request, service.preflight(get_settings(), data.checks, data.profiles))
