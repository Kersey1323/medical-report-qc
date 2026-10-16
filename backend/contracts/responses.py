from typing import Generic, TypeVar, Literal
from uuid import UUID
from pydantic import BaseModel
from contracts.errors import ErrorDetail

T = TypeVar("T")


class ApiSuccess(BaseModel, Generic[T]):
    status: Literal["success"] = "success"
    data: T
    detail: None = None
    request_id: UUID


class ApiErrorResponse(BaseModel):
    status: Literal["error"] = "error"
    data: None = None
    detail: ErrorDetail
    request_id: UUID
