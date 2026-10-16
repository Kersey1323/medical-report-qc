import httpx, pytest
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from app.clients.inference import InferenceClient
from app.clients.online import OnlineClient
from app.core.config import Settings
from app.core.exceptions import AppError
from contracts.inference import InferenceRequest


def test_timeout_polls_same_id():
    rid = uuid4()
    posts = []
    gets = []

    def route(r):
        if r.method == "POST":
            posts.append(1)
            raise httpx.ReadTimeout("timeout", request=r)
        gets.append(1)
        return httpx.Response(
            200,
            json={
                "status": "success",
                "data": {
                    "request_id": str(rid),
                    "status": "succeeded",
                    "output": {
                        "request_id": str(rid),
                        "text": "甲",
                        "raw_text": "甲",
                        "identity": {},
                        "stop_reason": "eos",
                    },
                },
            },
        )

    c = InferenceClient(
        Settings(), http=httpx.Client(transport=httpx.MockTransport(route))
    )
    req = InferenceRequest(
        request_id=rid,
        role="csc",
        source="甲",
        config_fingerprint="a",
        deadline_at=datetime.now(timezone.utc) + timedelta(seconds=2),
    )
    assert c.wait(req, lambda: None).text == "甲"
    assert len(posts) == 1 and len(gets) == 1


def test_200_error_is_failure():
    def route(r):
        return httpx.Response(
            200,
            json={
                "status": "error",
                "detail": {
                    "code": "queue_full",
                    "message": "满",
                    "retryable": True,
                    "stage": "queue",
                },
            },
        )

    c = InferenceClient(
        Settings(), http=httpx.Client(transport=httpx.MockTransport(route))
    )
    with pytest.raises(AppError) as err:
        c.health()
    assert err.value.detail.code == "queue_full"


def test_responses_payload():
    cfg = {
        "provider": "x",
        "model": "teacher",
        "base_url": "http://test/v1",
        "api_mode": "responses",
        "reasoning_effort": "low",
        "timeout": 1,
        "output_limit": 2048,
    }
    payload = OnlineClient.make_payload(
        cfg,
        [{"role": "system", "content": "system"}, {"role": "user", "content": "hello"}],
    )
    assert payload["reasoning"] == {"effort": "low"} and "temperature" not in payload


@pytest.mark.parametrize(
    "mode,body",
    [
        (
            "responses",
            {
                "id": "resp-partial",
                "status": "incomplete",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "partial-answer"}],
                    }
                ],
            },
        ),
        (
            "chat_completions",
            {
                "id": "resp-partial",
                "choices": [
                    {
                        "message": {"content": "partial-answer"},
                        "finish_reason": "length",
                    }
                ],
            },
        ),
        ("responses", {"id": "resp-partial", "status": "completed", "output": None}),
        ("responses", "malformed partial-answer"),
    ],
)
def test_failed_online_envelope_preserves_credential_free_audit(mode, body):
    from contextlib import nullcontext
    from types import SimpleNamespace

    c = OnlineClient(
        SimpleNamespace(teacher_api_key="synthetic-secret", online_api_key=""),
        http=httpx.Client(
            transport=httpx.MockTransport(
                lambda r: (
                    httpx.Response(200, json=body)
                    if isinstance(body, dict)
                    else httpx.Response(200, text=body)
                )
            )
        ),
        limiter=SimpleNamespace(hold=nullcontext),
    )
    cfg = {
        "api_mode": mode,
        "model": "synthetic-model",
        "provider": "synthetic",
        "base_url": "http://synthetic/v1",
    }
    with pytest.raises(AppError) as e:
        c.invoke(
            "teacher", [{"role": "user", "content": "synthetic prompt"}], uuid4(), cfg
        )
    assert e.value.detail.code == "response_invalid"
    assert e.value.raw_response and (
        "partial-answer" in e.value.raw_response or "null" in e.value.raw_response
    )
    assert (
        e.value.identity["model"] == "synthetic-model"
        and e.value.identity["role"] == "teacher"
    )
    assert "synthetic-secret" not in e.value.raw_response
    if isinstance(body, dict):
        assert e.value.identity["response_id"] == "resp-partial"
