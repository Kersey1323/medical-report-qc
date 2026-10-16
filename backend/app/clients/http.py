import httpx
from pydantic import ValidationError
from contracts.errors import ErrorDetail
from app.core.exceptions import UpstreamError, fail, sanitize, safe_exception_message


def unwrap(response, stage):
    try:
        response.raise_for_status()
        body = response.json()
        if body.get("status") == "error":
            d = ErrorDetail.model_validate(body["detail"])
            d.message = sanitize(d.message)
            d.cause = sanitize(d.cause) if d.cause else None
            d.context = {
                k: v
                for k, v in d.context.items()
                if k
                in [
                    "attempt_no",
                    "upstream_status",
                    "module_result_id",
                    "role",
                    "provider",
                    "model",
                    "retry_after",
                ]
            }
            raise UpstreamError(d)
        if body.get("status") != "success" or "data" not in body:
            raise ValueError("Invalid envelope")
        return body["data"]
    except (ValueError, ValidationError, httpx.HTTPStatusError) as exc:
        raise fail(
            "response_invalid", "上游响应结构或HTTP状态无效", stage, False
        ) from exc


def transport_error(exc, stage, remote_state=None):
    return UpstreamError(
        ErrorDetail(
            code="upstream_timeout"
            if isinstance(exc, httpx.TimeoutException)
            else "upstream_unavailable",
            message="上游连接失败或等待超时；请核对服务与请求状态",
            stage=stage,
            retryable=remote_state is None,
            remote_state=remote_state,
            exception_type=type(exc).__name__,
            cause="HTTP连接或读取未完成",
        )
    )
