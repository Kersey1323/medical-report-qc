"""Loguru owns sinks; render tracebacks without local values or unredacted messages."""

from __future__ import annotations

from datetime import datetime
import logging
import os
from pathlib import Path
import sys
import traceback
from zoneinfo import ZoneInfo

from loguru import logger
from app.core.exceptions import sanitize, safe_exception_message

_sinks: list[int] = []
_configured = False
_zone = ZoneInfo("Asia/Shanghai")


def _format(record):
    # A callable formatter prevents Loguru appending its unsanitized exception.
    r = record
    r["extra"]["safe_message"] = sanitize(r["message"], limit=5000)
    r["extra"]["local_time"] = r["time"].astimezone(_zone).strftime("%Y-%m-%d %H:%M:%S")
    fields = " ".join(
        f"{k}={sanitize(str(r['extra'][k]))}"
        for k in (
            "request_id",
            "task_id",
            "item_id",
            "module_result_id",
            "generation",
            "stage",
            "attempt",
            "max_attempts",
            "inference_request_id",
            "service",
            "instance_id",
        )
        if k in r["extra"]
    )
    r["extra"]["fields"] = fields
    r["extra"]["caller"] = r["extra"].get(
        "source_location", f"{r['file'].name}:{r['function']}:{r['line']}"
    )
    trace = ""
    if r["exception"]:
        current = r["exception"].value
        chain = []
        seen = set()
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            frames = "\n".join(
                f"  File {frame.filename}, line {frame.lineno}, in {frame.name}"
                for frame in traceback.extract_tb(current.__traceback__)
            )
            frames = "\n".join(
                sanitize(line, limit=2000) for line in frames.splitlines()
            )
            chain.append(
                f"{frames}\n{type(current).__name__}: {safe_exception_message(current)}"
            )
            current = current.__cause__ or (
                None if current.__suppress_context__ else current.__context__
            )
        trace = "\n" + "\nCaused by:\n".join(reversed(chain))
    r["extra"]["safe_trace"] = trace
    return (
        "{extra[local_time]} | {level} | {extra[caller]} - "
        "{extra[safe_message]} {extra[fields]}{extra[safe_trace]}\n"
    )


class InterceptHandler(logging.Handler):
    def emit(self, record):
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        logger.bind(
            source_location=f"{Path(record.pathname).name}:{record.funcName}:{record.lineno}"
        ).opt(exception=record.exc_info).log(level, record.getMessage())


def configure_logging(
    log_root: Path, *, service="medical-model", instance_id="local", reset=False
):
    global _configured
    if _configured and not reset:
        return
    if not _configured:
        try:
            logger.remove(0)
        except ValueError:
            pass
    for sink in _sinks:
        logger.remove(sink)
    _sinks.clear()
    logger.configure(extra={"service": service, "instance_id": instance_id})
    _sinks.append(
        logger.add(
            sys.stdout,
            level="INFO",
            format=_format,
            colorize=sys.stdout.isatty(),
            diagnose=False,
            backtrace=False,
        )
    )
    directory = (
        Path(log_root).resolve() / service / instance_id / f"pid-{os.getpid()}" / "app"
    )
    try:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)

        # A timezone-aware rotation callable enforces Shanghai midnight.
        def rotation(message, file):
            stamp = datetime.fromtimestamp(os.path.getmtime(file.name), _zone).date()
            return message.record["time"].astimezone(_zone).date() > stamp

        _sinks.append(
            logger.add(
                directory / "app_{time:YYYY-MM-DD}.log",
                level="DEBUG",
                format=_format,
                rotation=rotation,
                retention="30 days",
                compression="zip",
                encoding="utf-8",
                diagnose=False,
                backtrace=False,
                opener=lambda p, f: os.open(p, f, 0o600),
            )
        )
    except OSError as exc:
        logger.warning(
            "文件日志初始化失败，保留控制台: error_type={}", type(exc).__name__
        )
    logging.basicConfig(handlers=[InterceptHandler()], level=logging.INFO, force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        target = logging.getLogger(name)
        target.handlers = []
        target.propagate = True
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    _configured = True
