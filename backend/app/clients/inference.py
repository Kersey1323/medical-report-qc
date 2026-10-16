from datetime import datetime, timezone
from time import sleep
from contextvars import ContextVar
import httpx
from contracts.inference import RequestState, InferenceOutput
from app.clients.http import unwrap, transport_error
from app.core.exceptions import AppError, fail
from contracts.errors import ErrorDetail

resuming_remote = ContextVar("resuming_remote", default=False)


class InferenceClient:
    def __init__(self, settings, http=None):
        self.settings = settings
        self.url = settings.model_service_url.rstrip("/")
        self.http = http or httpx.Client(
            timeout=httpx.Timeout(15, connect=3),
            transport=httpx.HTTPTransport(retries=0),
        )
        self.headers = (
            {"Authorization": "Bearer " + settings.model_service_token}
            if settings.model_auth_enabled
            else {}
        )

    def health(self):
        try:
            return unwrap(
                self.http.get(self.url + "/health/ready", headers=self.headers),
                "model.health",
            )
        except httpx.RequestError as exc:
            raise transport_error(exc, "model.health") from exc

    def submit(self, request, trace_id=None):
        path = {
            "diagnosis": "diagnosis/generate",
            "csc": "csc/correct",
            "cgec": "cgec/correct",
        }[request.role]
        headers = self.headers | ({"X-Request-ID": str(trace_id)} if trace_id else {})
        return RequestState.model_validate(
            unwrap(
                self.http.post(
                    self.url + "/internal/v1/" + path,
                    json=request.model_dump(mode="json"),
                    headers=headers,
                ),
                "model.submit",
            )
        )

    def get(self, request_id):
        try:
            return RequestState.model_validate(
                unwrap(
                    self.http.get(
                        self.url + f"/internal/v1/requests/{request_id}",
                        headers=self.headers,
                    ),
                    "model.get",
                )
            )
        except httpx.RequestError as exc:
            raise transport_error(exc, "model.get", "unknown") from exc

    def wait(self, request, on_heartbeat, trace_id=None):
        try:
            state = (
                self.get(request.request_id)
                if resuming_remote.get()
                else self.submit(request, trace_id)
            )
        except httpx.RequestError:
            # Submission may have committed. Never POST this attempt again.
            state = self.get(request.request_id)
        while True:
            if state.status == "succeeded":
                if state.output is None:
                    raise fail("response_invalid", "推理成功但缺少输出", "model.wait")
                return state.output
            if state.status in ("failed", "cancelled"):
                raise AppError(
                    state.error
                    or ErrorDetail(
                        code="inference_failed",
                        message="推理未成功",
                        stage="model.wait",
                    )
                )
            if state.status == "unknown":
                raise AppError(
                    ErrorDetail(
                        code="remote_state_unknown",
                        message="原请求状态未知，禁止自动重发",
                        stage="model.wait",
                        remote_state="unknown",
                    )
                )
            on_heartbeat()
            if datetime.now(timezone.utc) >= request.deadline_at:
                raise AppError(
                    ErrorDetail(
                        code="upstream_timeout",
                        message="推理等待到达期限，原请求仍可能运行",
                        stage="model.wait",
                        remote_state=state.status,
                        retryable=False,
                        context={"inference_request_id": str(request.request_id)},
                    )
                )
            sleep(1)
            state = self.get(request.request_id)
