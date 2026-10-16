from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool = False
    stage: str = "api"
    remote_state: str | None = None
    exception_type: str | None = None
    cause: str | None = None
    context: dict = Field(default_factory=dict)
