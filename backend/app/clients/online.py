from dataclasses import dataclass
from time import perf_counter
import httpx
from redis import Redis
from app.clients.rate_limit import GlobalPermit
from app.core.exceptions import (
    AppError,
    StageValidationError,
    UpstreamError,
    fail,
    sanitize,
    protected_values,
)
from contracts.errors import ErrorDetail


@dataclass
class OnlineResponse:
    raw_text: str
    response_id: str | None
    provider: str
    model: str
    api_mode: str
    usage: dict
    elapsed_ms: float
    finish_reason: str | None


class OnlineClient:
    def __init__(self, settings, http=None, limiter=None):
        self.settings = settings
        self.http = http or httpx.Client(transport=httpx.HTTPTransport(retries=0))
        self.limiter = limiter or GlobalPermit(
            Redis.from_url(settings.redis_url, socket_timeout=3), settings.redis_prefix
        )

    def available(self, role, config):
        key = getattr(self.settings, role + "_api_key") or self.settings.online_api_key
        if not key or not config.get("model") or not config.get("base_url"):
            return False, "缺少配置"
        try:
            r = self.http.get(
                config["base_url"].rstrip("/") + "/models",
                headers={"Authorization": "Bearer " + key},
                timeout=8,
            )
            if r.status_code != 200:
                return False, "模型目录探测被拒绝（HTTP " + str(r.status_code) + "）"
            models = r.json().get("data", [])
            if not any(m.get("id") == config["model"] for m in models):
                return False, "模型目录中没有配置的模型 " + config["model"]
            return True, None
        except (httpx.RequestError, ValueError, TypeError, AttributeError):
            return False, "在线模型目录探测失败"

    @staticmethod
    def make_payload(config, messages):
        payload = {"model": config["model"]}
        if config["api_mode"] == "responses":
            payload.update(
                input=[m for m in messages if m["role"] != "system"],
                instructions="\n".join(
                    m["content"] for m in messages if m["role"] == "system"
                ),
                max_output_tokens=config.get("output_limit", 2048),
            )
            if config.get("reasoning_effort"):
                payload["reasoning"] = {"effort": config["reasoning_effort"]}
        elif config["api_mode"] == "chat_completions":
            payload.update(
                messages=messages, max_tokens=config.get("output_limit", 2048)
            )
            if "temperature" in config:
                payload["temperature"] = config["temperature"]
        else:
            raise fail("input_validation_error", "未知在线API协议", "online.config")
        return payload

    def invoke(self, role, messages, request_id, config):
        key = getattr(self.settings, role + "_api_key") or self.settings.online_api_key
        if not key or not config.get("model") or not config.get("base_url"):
            raise fail("preflight_failed", "在线角色缺少配置", "online." + role)
        start = perf_counter()
        url = config["base_url"].rstrip("/") + (
            "/responses" if config["api_mode"] == "responses" else "/chat/completions"
        )
        with (
            protected_values(key, *[m["content"] for m in messages]),
            self.limiter.hold(),
        ):
            r = None
            data = {}
            try:
                r = self.http.post(
                    url,
                    json=self.make_payload(config, messages),
                    headers={
                        "Authorization": "Bearer " + key,
                        "X-Request-ID": str(request_id),
                    },
                    timeout=config.get("timeout", 120),
                )
                if r.status_code >= 400:
                    raise UpstreamError(
                        ErrorDetail(
                            code="upstream_http_error",
                            message="在线模型请求被供应商拒绝，请核对模型授权、额度或服务状态",
                            stage="online." + role,
                            retryable=r.status_code in (408, 429)
                            or r.status_code >= 500,
                            context={
                                "upstream_status": r.status_code,
                                "model": config["model"],
                                "provider": config["provider"],
                                "retry_after": sanitize(
                                    r.headers.get("Retry-After", "")
                                ),
                            },
                        )
                    )
                data = r.json()
                if config["api_mode"] == "responses":
                    if data.get("status") != "completed":
                        raise fail(
                            "response_invalid",
                            "在线Responses输出未完整结束",
                            "online." + role,
                            True,
                        )
                    text = "".join(
                        part.get("text", "")
                        for output in data.get("output", [])
                        if output.get("type") == "message"
                        for part in output.get("content", [])
                        if part.get("type") == "output_text"
                    )
                    finish = data.get("status")
                else:
                    choice = data["choices"][0]
                    text = choice["message"]["content"]
                    finish = choice.get("finish_reason")
                    if finish != "stop":
                        raise fail(
                            "response_invalid",
                            "在线输出截断或未正常停止",
                            "online." + role,
                            True,
                        )
                if not isinstance(text, str) or not text.strip():
                    raise fail(
                        "response_invalid", "在线模型返回空文本", "online." + role, True
                    )
                return OnlineResponse(
                    text,
                    data.get("id"),
                    config["provider"],
                    config["model"],
                    config["api_mode"],
                    data.get("usage", {}),
                    (perf_counter() - start) * 1000,
                    finish,
                )
            except AppError as exc:
                if r is not None:
                    # Explicit audit data only: never store request headers or credentials.
                    identity = {
                        "role": role,
                        "provider": config["provider"],
                        "model": config["model"],
                        "api_mode": config["api_mode"],
                        "response_id": data.get("id")
                        if isinstance(data, dict)
                        else None,
                        "elapsed_ms": (perf_counter() - start) * 1000,
                        "upstream_status": r.status_code,
                    }
                    raw = r.text.replace(key, "[REDACTED]")
                    raise StageValidationError(exc.detail, raw, identity) from exc
                raise
            except httpx.RequestError as exc:
                # Online providers lack query-by-ID recovery; ambiguous timeout is explicit.
                raise UpstreamError(
                    ErrorDetail(
                        code="upstream_timeout",
                        message="在线调用连接或读取超时",
                        stage="online." + role,
                        retryable=True,
                        exception_type=type(exc).__name__,
                        cause="供应商响应未在期限内完成",
                    )
                ) from exc
            except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
                detail = fail(
                    "response_invalid", "在线响应结构无效", "online." + role, True
                ).detail
                identity = {
                    "role": role,
                    "provider": config["provider"],
                    "model": config["model"],
                    "api_mode": config["api_mode"],
                    "response_id": data.get("id") if isinstance(data, dict) else None,
                }
                raise StageValidationError(
                    detail,
                    r.text.replace(key, "[REDACTED]") if r is not None else "",
                    identity,
                ) from exc
