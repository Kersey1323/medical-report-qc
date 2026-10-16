from app.schemas.dto import ImportDTO
from uuid import UUID
from fastapi import APIRouter, Depends, Request, UploadFile, File
from sqlalchemy import select
from app.api.dependencies import session
from app.api.envelope import ok, RESPONSES
from contracts.responses import ApiSuccess, ApiErrorResponse
from app.schemas.requests import ColumnMapping
from app.services.import_service import register_upload, confirm_import
from app.services.common import require
from app.db.models import Import, ImportRow
from app.core.config import get_settings
from app.core.exceptions import fail

router = APIRouter()


def dto(s, row):
    rows = s.scalars(
        select(ImportRow)
        .where(ImportRow.import_id == row.id)
        .order_by(ImportRow.original_row)
    ).all()
    return {
        "id": row.id,
        "filename": row.filename,
        "status": row.status,
        "columns": row.columns,
        "preview_rows": [
            {"original_row": r.original_row, "cells": r.cells, "errors": r.errors}
            for r in rows[:10]
        ],
        "errors": row.errors,
        "confirmed": row.confirmed,
        "mapping": row.mapping,
        "checks": row.checks,
        "total_rows": len(rows),
        "valid_rows": sum(bool(r.report_id) for r in rows),
        "invalid_rows": [
            {"original_row": r.original_row, "errors": r.errors}
            for r in rows
            if row.confirmed and not r.report_id
        ],
    }


@router.post(
    "/imports", status_code=202, response_model=ApiSuccess[ImportDTO] | ApiErrorResponse
)
async def upload(
    request: Request, file: UploadFile = File(...), s=Depends(session, scope="function")
):
    content = await file.read(20 * 1024 * 1024 + 1)
    row = register_upload(
        s, file.filename, content, get_settings(), request.state.request_id
    )
    return ok(request, dto(s, row))


@router.get("/imports/{id}", response_model=ApiSuccess[ImportDTO] | ApiErrorResponse)
def get(id: UUID, request: Request, s=Depends(session, scope="function")):
    return ok(request, dto(s, require(s, Import, id)))


@router.post(
    "/imports/{id}/confirm",
    status_code=201,
    response_model=ApiSuccess[dict] | ApiErrorResponse,
)
def confirm(
    id: UUID,
    data: ColumnMapping,
    request: Request,
    s=Depends(session, scope="function"),
):
    return ok(request, confirm_import(s, str(id), data))
