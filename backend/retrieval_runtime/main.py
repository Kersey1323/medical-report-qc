from contextlib import asynccontextmanager
from threading import Lock
import httpx, yaml
from fastapi import FastAPI, Request
from contracts.responses import ApiSuccess
from contracts.retrieval import RetrievalRequest, CandidateSet
from app.core.config import get_settings
from app.core.exceptions import fail, error_from_exception
from app.core.logging_config import logger, configure_logging
from app.clients.http import unwrap
from app.api.envelope import ok
from app.services.common import digest
from retrieval_runtime.filtering import filter_candidates
from retrieval_runtime.reranker import CpuReranker
from retrieval_runtime.index import HybridIndex
from retrieval_runtime.embedding import make_embedder


def create_app():
    settings = get_settings()
    state = {"ready": False, "reason": "索引未加载"}
    lock = Lock()

    @asynccontextmanager
    async def lifespan(app):
        configure_logging(
            settings.app_log_dir,
            service="retrieval",
            instance_id=settings.instance_id,
            reset=True,
        )
        cfg = yaml.safe_load(settings.retrieval_config_file.read_text())
        state["config"] = cfg
        http = httpx.Client(transport=httpx.HTTPTransport(retries=0))
        state["http"] = http
        headers = (
            {"Authorization": "Bearer " + settings.model_service_token}
            if settings.model_auth_enabled
            else {}
        )
        try:
            logger.info("医学索引加载开始")
            health = unwrap(
                http.get(
                    settings.model_service_url + "/health/ready",
                    headers=headers,
                    timeout=5,
                ),
                "retrieval.load",
            )
            cpum = health["cpu_models"]
            embedding = next(m for m in cpum["models"] if m["role"] == "embedding")
            if (
                embedding["digest"] != cfg["embedding"]["expected_digest"]
                or embedding["dimension"] != cfg["index"]["expected_dimension"]
            ):
                raise fail(
                    "embedding_mismatch", "查询embedding与配置不一致", "retrieval.load"
                )
            historical = cfg["index"].get("historical_embedding_digest")
            if historical and historical != embedding["digest"]:
                raise fail(
                    "embedding_mismatch",
                    "历史索引embedding身份不匹配",
                    "retrieval.load",
                )
            if not historical and not settings.allow_unknown_embedding_provenance:
                raise fail(
                    "embedding_provenance_unknown",
                    "历史向量库缺少embedding摘要；需核对来源后显式设置ALLOW_UNKNOWN_EMBEDDING_PROVENANCE=true，风险写入结果",
                    "retrieval.load",
                )
            reranker_identity = next(
                m for m in cpum["models"] if m["role"] == "reranker"
            )
            state["reranker_fingerprint"] = digest(reranker_identity)
            state["embedding"] = embedding["digest"]
            state["cpu_fingerprint"] = cpum["config_fingerprint"]
            state["index"] = HybridIndex()
            state["index"].restore(
                __import__("pathlib").Path(cfg["index"]["cache_dir"])
                / cfg["index"]["data_file"],
                make_embedder(
                    settings.model_service_url, http, headers, state["embedding"]
                ),
                cfg["index"]["expected_dimension"],
            )
            from retrieval_runtime.source_reports import SourceReportResolver

            state["index"].resolver = SourceReportResolver(
                cfg.get("source_reports", {}).get("allowlist_files", [])
            )
            state["reranker"] = CpuReranker(
                settings.model_service_url, http, headers, reranker_identity
            )
            state["ready"] = True
            state["reason"] = None
            logger.info("医学索引加载完成: nodes={}", len(state["index"].nodes))
        except Exception as exc:
            state["reason"] = error_from_exception(exc, "retrieval.load").message
            logger.opt(exception=exc).error("医学索引加载失败")
        yield
        http.close()

    # Reuse business factory's HTTP middleware/handlers without importing/loading index there.
    from app.main import create_app as business_app

    app = business_app()
    app.router.routes = [
        r for r in app.router.routes if not getattr(r, "path", "").startswith("/api/v1")
    ]
    app.router.lifespan_context = lifespan

    @app.get("/health/ready", response_model=ApiSuccess[dict])
    def health(request: Request):
        return ok(
            request,
            {
                "ready": state["ready"],
                "reason": state["reason"],
                "index_fingerprint": getattr(state.get("index"), "fingerprint", None),
                "embedding_fingerprint": state.get("embedding"),
                "config_fingerprint": digest(state["config"])
                if "config" in state
                else None,
                "cpu_fingerprint": state.get("cpu_fingerprint"),
                "reranker_fingerprint": state.get("reranker_fingerprint"),
                "nodes": len(state["index"].nodes) if "index" in state else 0,
                "historical_embedding_provenance": "unknown"
                if not state.get("config", {})
                .get("index", {})
                .get("historical_embedding_digest")
                else "recorded",
            },
        )

    @app.post("/internal/v1/retrieve", response_model=ApiSuccess[CandidateSet])
    def retrieve(data: RetrievalRequest, request: Request):
        if not state["ready"]:
            raise fail("preflight_failed", state["reason"] or "检索不可用", "retrieval")
        if data.config_fingerprint != digest(state["config"]):
            raise fail(
                "retrieval_identity_mismatch",
                "检索运行配置与冻结配置不一致",
                "retrieval",
            )
        if not lock.acquire(timeout=300):
            raise fail("cpu_busy", "检索服务忙", "retrieval", True)
        try:
            candidates = state["index"].retrieve(data.source, data.recall_k)
            if not candidates:
                raise fail("no_valid_evidence", "没有召回候选", "retrieval")
            candidates = state["reranker"].score(
                data.source, candidates, state["cpu_fingerprint"]
            )
            result = CandidateSet(
                candidates=filter_candidates(data.source, candidates),
                index_fingerprint=state["index"].fingerprint,
                embedding_fingerprint=state["embedding"],
                config_fingerprint=digest(state["config"]),
                cpu_fingerprint=state["cpu_fingerprint"],
                reranker_fingerprint=state["reranker_fingerprint"],
            )
            return ok(request, result)
        finally:
            lock.release()

    return app


app = create_app()
