from fastapi import Request
from contracts.responses import ApiSuccess, ApiErrorResponse


def ok(request, data):
    return {
        "status": "success",
        "data": data,
        "detail": None,
        "request_id": request.state.request_id,
    }


# Stable shared error envelope on every owned JSON route.
RESPONSES = {200: {"model": ApiErrorResponse}}
