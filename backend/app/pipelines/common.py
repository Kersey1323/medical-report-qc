from datetime import datetime, timezone, timedelta
from dataclasses import asdict
from pathlib import Path
from app.domain.results import StageOutput
from contracts.inference import InferenceRequest, SourceSpan
from contracts.errors import ErrorDetail
from app.core.exceptions import StageValidationError, AppError
from app.services.common import digest

PROMPTS = Path(__file__).resolve().parents[2] / "prompts"


def prompt(name):
    return (PROMPTS / name).read_text()


def stage_online(stages, online, role, stage, messages, context, validate):
    cfg = context.config.snapshot.get("online_roles", {}).get(role, {})

    def invoke(rid, n):
        response = online.invoke(role, messages, rid, cfg)
        identity = {
            "provider": response.provider,
            "model": response.model,
            "api_mode": response.api_mode,
            "response_id": response.response_id,
            "parameters": cfg,
        }
        try:
            parsed = validate(response.raw_text)
        except AppError as exc:
            raise StageValidationError(
                exc.detail, raw_response=response.raw_text, identity=identity
            ) from exc
        return StageOutput(
            payload={
                "raw_text": response.raw_text,
                "parsed": parsed,
                "usage": response.usage,
                "elapsed_ms": response.elapsed_ms,
                "finish_reason": response.finish_reason,
            },
            identity=identity,
            request_id=rid,
        )

    return stages.run(stage, "", digest([messages, cfg]), context, invoke)


def stage_infer(
    stages,
    inference,
    role,
    stage,
    source,
    context,
    *,
    completion=None,
    chunk_key="",
    validate=None,
):
    fp = context.config.snapshot.get("preflight", {}).get(
        "model_config_fingerprint", ""
    )

    def invoke(rid, n):
        params = {"attempt_no": n}
        if role == "diagnosis":
            params["max_new_tokens"] = 512
        req = InferenceRequest(
            request_id=rid,
            role=role,
            source=source,
            prompt=completion,
            config_fingerprint=fp,
            parameters=params,
            deadline_at=datetime.now(timezone.utc) + timedelta(seconds=850),
        )
        output = inference.wait(req, context.heartbeat, trace_id=context.request_id)
        if not output.text.strip():
            raise StageValidationError(
                ErrorDetail(
                    code="response_invalid",
                    message="推理返回空文本",
                    stage=stage,
                    retryable=True,
                ),
                output.raw_text,
                output.identity,
            )
        if validate:
            validate(output)
        return StageOutput(
            payload=output.model_dump(mode="json"),
            identity=output.identity,
            request_id=rid,
        )

    return stages.run(
        stage, chunk_key, digest([source, completion, fp]), context, invoke
    )


def edits_to_spans(edits):
    return [SourceSpan(start=e.start, end=e.end, text=e.before) for e in edits]


def apply_edits(source, edits):
    out = source
    for e in sorted(edits, key=lambda e: (e.start, e.end), reverse=True):
        out = out[: e.start] + e.after + out[e.end :]
    return out


def attach_partial(exc, *, details=None, evidence=None, stages=None):
    """Carry validated earlier stages to the durable unit boundary on later failure."""
    exc.partial_details = details or {}
    exc.partial_evidence = evidence or []
    exc.partial_stages = stages or []
