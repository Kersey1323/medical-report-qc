from fastapi import APIRouter
from app.api.v1 import reports, imports, runs, results, reviews, exports, system, single

router = APIRouter(prefix="/api/v1")
for routes in [reports, imports, runs, results, reviews, exports, system, single]:
    router.include_router(routes.router)
