"""NDJSON stream; no session/database dependency and no task/outbox creation."""
import asyncio
import json
from queue import Queue, Empty, Full
from threading import BoundedSemaphore, Event, Thread
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from app.core.config import get_settings
from app.core.exceptions import Cancelled, fail
from app.schemas.requests import SingleCheck
from app.services.single_service import run_single

router = APIRouter(tags=["single"])
_slots = BoundedSemaphore(4)


@router.post("/single/stream", response_class=StreamingResponse)
async def single_stream(data: SingleCheck, request: Request):
    if not _slots.acquire(blocking=False):
        raise fail("single_busy", "当前即时质控连接较多，请稍后再试", "single.admission", True)
    cancelled = Event()
    queue = Queue(maxsize=64)
    finished = Event()
    request_id = request.state.request_id

    def publish(event):
        while not cancelled.is_set():
            try:
                queue.put(event, timeout=.2)
                return
            except Full:
                continue
        raise Cancelled()

    def worker():
        try:
            run_single(data, get_settings(), request_id, publish, cancelled)
        finally:
            finished.set()
            _slots.release()

    thread = Thread(target=worker, daemon=True, name="single-qc-"+request_id[:8])
    try:
        thread.start()
    except BaseException:
        _slots.release()
        raise

    async def stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.to_thread(queue.get, True, 1)
                except Empty:
                    if finished.is_set():
                        break
                    event = {"type": "heartbeat"}
                detail = event.get("detail") if event["type"] == "error" else None
                body = {"status": "error" if detail else "success", "data": event,
                        "detail": detail, "request_id": request_id}
                yield json.dumps(body, ensure_ascii=False)+"\n"
        finally:
            cancelled.set()

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })
