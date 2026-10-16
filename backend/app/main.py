from uuid import uuid4, UUID
from contextlib import asynccontextmanager
import asyncio
from time import perf_counter
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from app.core.exceptions import AppError, error_from_exception, sanitize
from app.core.logging_config import logger, configure_logging
from app.core.config import get_settings
from app.api.router import router


def create_app():
    settings = get_settings()
    configure_logging(
        settings.app_log_dir, service="api", instance_id=settings.instance_id
    )

    @asynccontextmanager
    async def lifespan(app):
        from app.core.exceptions import register_secrets

        register_secrets(
            settings.database_url,
            settings.model_service_token,
            settings.online_api_key,
            settings.judge_api_key,
            settings.teacher_api_key,
            settings.localizer_api_key,
        )
        if not hasattr(app.state, "session_factory"):
            from app.tasks.recovery import recover_once
            from app.db.session import get_factory
            from app.clients.inference import InferenceClient

            try:
                await asyncio.to_thread(
                    recover_once, get_factory(), InferenceClient(settings).get
                )
            except Exception as exc:
                logger.opt(exception=exc).error("启动恢复失败，任务保留待运维恢复")
        yield

    app = FastAPI(
        title="Medical Report QC", version="0.1.0", debug=False, lifespan=lifespan
    )

    @app.middleware("http")
    async def context(request: Request, call_next):
        try:
            rid = str(UUID(request.headers.get("X-Request-ID", "")))
        except ValueError:
            rid = str(uuid4())
        request.state.request_id = rid
        start = perf_counter()
        with logger.contextualize(request_id=rid):
            try:
                response = await call_next(request)
            except Exception as exc:
                response = await error_handler(request, exc)
            response.headers["X-Request-ID"] = rid
            logger.info(
                "接口请求结束: method={}, path={}, http_status={}, response_status={}, error_code={}, duration_ms={:.1f}",
                request.method,
                request.url.path,
                response.status_code,
                getattr(request.state, "response_status", "success"),
                getattr(request.state, "error_code", ""),
                (perf_counter() - start) * 1000,
            )
            return response

    async def error_handler(request, exc):
        if isinstance(exc, RequestValidationError):
            detail = error_from_exception(
                exc, "api.validation", code="input_validation_error"
            )
        elif isinstance(exc, HTTPException):
            detail = error_from_exception(
                exc,
                "api.routing",
                code="resource_not_found"
                if exc.status_code == 404
                else "method_not_allowed",
            )
        else:
            detail = error_from_exception(exc, "api.unhandled")
        request.state.response_status = "error"
        request.state.error_code = detail.code
        if not isinstance(exc, (AppError, RequestValidationError, HTTPException)):
            logger.opt(exception=exc).error("接口操作失败: error_code={}", detail.code)
        return JSONResponse(
            {
                "status": "error",
                "data": None,
                "detail": detail.model_dump(mode="json"),
                "request_id": getattr(request.state, "request_id", str(uuid4())),
            },
            status_code=200,
        )

    for cls in (AppError, RequestValidationError, HTTPException, Exception):
        app.add_exception_handler(cls, error_handler)
    app.include_router(router)
    original = app.openapi

    def openapi():
        schema = original()
        for path in schema.get("paths", {}).values():
            for method in path.values():
                if isinstance(method, dict):
                    method.get("responses", {}).pop("422", None)
        return schema

    app.openapi = openapi
    return app


app = create_app()
