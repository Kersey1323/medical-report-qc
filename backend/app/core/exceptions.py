from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import re
import json
from pydantic import ValidationError
from contracts.errors import ErrorDetail

_sensitive = ContextVar("sensitive_values", default=())
_static_secrets: tuple[str, ...] = ()


def register_secrets(*values: str) -> None:
    global _static_secrets
    _static_secrets = tuple(v for v in values if v)


@contextmanager
def protected_values(*values: str):
    token = _sensitive.set(tuple(v for v in values if v) + _sensitive.get())
    try:
        yield
    finally:
        _sensitive.reset(token)


def sanitize(value: str, secrets=(), limit: int = 1000) -> str:
    text = str(value)
    variants = set()
    for value in (*_static_secrets, *_sensitive.get(), *secrets):
        if value:
            variants.update(
                (
                    value,
                    repr(value),
                    repr(value)[1:-1],
                    json.dumps(value, ensure_ascii=False)[1:-1],
                )
            )
            variants.update(line for line in value.splitlines() if len(line) >= 4)
    for secret in sorted(variants, key=len, reverse=True):
        if secret:
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"(?i)(bearer\s+)[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(
        r"(?i)((?:password|passwd|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;]+",
        r"\1[REDACTED]",
        text,
    )
    text = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", text)
    return text[:limit]


class AppError(Exception):
    def __init__(self, detail: ErrorDetail):
        self.detail = detail
        super().__init__(detail.message)


class InputValidationError(AppError):
    pass


class ResourceNotFoundError(AppError):
    pass


class RevisionConflictError(AppError):
    pass


class PreflightError(AppError):
    pass


class UpstreamError(AppError):
    pass


class InfrastructureError(AppError):
    pass


class StageValidationError(AppError):
    def __init__(self, detail, raw_response="", identity=None):
        super().__init__(detail)
        self.raw_response = raw_response
        self.identity = identity or {}


class Cancelled(Exception):
    pass


def fail(code, message, stage="api", retryable=False, **context):
    return AppError(
        ErrorDetail(
            code=code,
            message=sanitize(message),
            stage=stage,
            retryable=retryable,
            context=context,
        )
    )


def safe_exception_message(exc, secrets=()):
    if (
        isinstance(exc, ValidationError)
        or type(exc).__name__ == "RequestValidationError"
    ):
        return "输入字段校验失败；请检查字段类型、必填项及长度"
    if isinstance(exc, UnicodeError):
        return "文本编码无效；原始字节不写入普通日志"
    if isinstance(exc, AssertionError):
        return "内部断言失败；请按堆栈位置检查协议"
    if type(exc).__module__.startswith(("sqlalchemy", "pymysql")):
        return "数据库操作失败；请检查连接、权限、迁移及唯一约束（SQL参数不展示）"
    return sanitize(str(exc), secrets) or type(exc).__name__


def error_from_exception(exc, stage, secrets=(), code=None):
    if isinstance(exc, AppError):
        return exc.detail
    return ErrorDetail(
        code=code or "internal_error",
        message=safe_exception_message(exc, secrets),
        stage=stage,
        exception_type=type(exc).__name__,
        cause=safe_exception_message(exc.__cause__, secrets) if exc.__cause__ else None,
    )
