from app.schemas.dto import ArtifactDTO
from uuid import UUID
from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.schemas.requests import ExportCreate
from app.services.export_service import request_export, artifact_dto
from app.services.common import require
from app.db.models import Artifact
from app.core.exceptions import fail
from pathlib import Path

router = APIRouter()


@router.post(
    "/exports",
    status_code=202,
    response_model=ApiSuccess[ArtifactDTO] | ApiErrorResponse,
)
def create(data: ExportCreate, request: Request, s=Depends(session, scope="function")):
    return ok(request, request_export(s, str(data.run_id)))


@router.get("/exports/{id}", response_model=ApiSuccess[ArtifactDTO] | ApiErrorResponse)
def get(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, artifact_dto(require(s, Artifact, id)))


@router.get("/exports/{id}/download", responses=RESPONSES)
def download(id: UUID, s=Depends(session, scope="function")):
    a = require(s, Artifact, id)
    if a.status != "ready" or not a.path or not Path(a.path).is_file():
        raise fail(
            "artifact_not_ready", "导出文件尚未生成成功", "export.download", True
        )
    return FileResponse(
        a.path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=a.filename,
    )
