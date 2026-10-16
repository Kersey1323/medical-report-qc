from sqlalchemy import select, func, text
from redis import Redis
from app.db.models import *
from app.core.config import get_settings
from app.core.exceptions import error_from_exception, fail
from app.services.review_service import pending_review
from app.services.common import digest
from pathlib import Path
import yaml, hashlib, json

DEFAULT_PROFILES = {
    "diagnosis": "diagnosis_thesis",
    "csc": "csc_punctuation_128_v1",
    "cgec": "cgec_rag_reference_1_5b",
    "rag": "rag_localization_two_stage_v1",
}


def config_snapshot(settings, checks, profiles):
    for k, v in profiles.items():
        if k not in DEFAULT_PROFILES or v != DEFAULT_PROFILES[k]:
            raise fail(
                "input_validation_error", "未知方法配置，禁止静默切换", "system.config"
            )
    cfg = (
        yaml.safe_load(settings.online_config_file.read_text())
        if settings.online_config_file.exists()
        else {}
    )
    prompts = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in (Path(__file__).resolve().parents[2] / "prompts").glob("*.txt")
    }
    retrieval = yaml.safe_load(settings.retrieval_config_file.read_text())
    return {
        "profiles": DEFAULT_PROFILES | profiles,
        "online_roles": cfg.get("online_roles", {}),
        "engineering_model_revision": cfg.get("engineering_model_revision"),
        "research_manifest": json.loads(
            (
                Path(__file__).resolve().parents[2] / "research_adapters/manifest.json"
            ).read_text()
        ),
        "retrieval": retrieval,
        "prompt_hashes": prompts,
        "model_service_url": settings.model_service_url,
        "method_version": "2026-10-15-v1",
        "engineering_differences": [
            "csc_punctuation_128_v1",
            "cgec_single_line_batch1",
            "rag_duplicate_filter_v1",
        ],
    }


def preflight(settings, checks, profiles=None, snapshot=None):
    from app.clients.inference import InferenceClient
    from app.clients.retrieval import RetrievalClient
    from app.clients.online import OnlineClient
    import httpx

    with httpx.Client(transport=httpx.HTTPTransport(retries=0), timeout=8) as http:
        return _preflight(settings, checks, profiles, snapshot, http)


def _preflight(settings, checks, profiles, snapshot, http):
    from app.clients.inference import InferenceClient
    from app.clients.retrieval import RetrievalClient
    from app.clients.online import OnlineClient

    online = OnlineClient(settings, http=http)
    online_probes = {}
    cfg = snapshot or config_snapshot(settings, checks, profiles or {})
    reasons = {b: [] for b in checks}
    identities = []
    gpu = {}
    retr = {}
    gpu_error = None
    ret_error = None
    if any(b in checks for b in ["diagnosis", "csc", "cgec"]):
        try:
            gpu = InferenceClient(settings, http=http).health()
            identities.extend(gpu.get("models", []))
            if not gpu.get("ready"):
                gpu_error = "推理服务尚未就绪"
        except Exception as exc:
            gpu_error = error_from_exception(exc, "system.preflight").message
    if any(b in checks for b in ["cgec", "rag"]):
        try:
            retr = RetrievalClient(settings, http=http).health()
            if not retr.get("ready"):
                ret_error = retr.get("reason", "检索服务尚未就绪")
            elif retr.get("config_fingerprint") != digest(
                cfg.get("retrieval", {})
            ) or not all(
                retr.get(k)
                for k in (
                    "index_fingerprint",
                    "embedding_fingerprint",
                    "cpu_fingerprint",
                    "reranker_fingerprint",
                )
            ):
                ret_error = "检索运行配置或资产身份与任务配置不一致"
        except Exception as exc:
            ret_error = error_from_exception(exc, "system.preflight").message
    for b in checks:
        if b in ("diagnosis", "csc", "cgec"):
            if gpu_error:
                reasons[b].append(gpu_error)
            elif not any(m.get("role") == b for m in gpu.get("models", [])):
                reasons[b].append("推理服务未报告所需角色身份")
        if b in ("cgec", "rag") and ret_error:
            reasons[b].append(ret_error)
        role = {"diagnosis": "judge", "cgec": "teacher", "rag": "localizer"}.get(b)
        if role:
            rc = cfg["online_roles"].get(role, {})
            key = getattr(settings, role + "_api_key") or settings.online_api_key
            if not key or not rc.get("model") or not rc.get("base_url"):
                reasons[b].append("在线角色 " + role + " 缺少模型、地址或密钥配置")
            else:
                # Each role may use different credentials for the same endpoint/model.
                # Never reuse another role's authorization success or failure.
                probe_key = (role, rc["base_url"], rc["model"])
                if probe_key not in online_probes:
                    online_probes[probe_key] = online.available(role, rc)
                available, reason = online_probes[probe_key]
                if not available:
                    reasons[b].append(reason)
    try:
        Redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2
        ).ping()
    except Exception:
        for b in checks:
            reasons[b].append("Redis限流服务不可用")
    return {
        "ready": not any(reasons.values()),
        "branches": {
            b: {
                "ready": not rs,
                "reasons": [
                    {
                        "code": "preflight_failed",
                        "message": r,
                        "stage": "system.preflight",
                        "retryable": False,
                    }
                    for r in rs
                ],
            }
            for b, rs in reasons.items()
        },
        "identities": identities,
        "capacity": {
            "model_service_ready": gpu.get("ready", False),
            "online_global_concurrency": 2,
            "retrieval": retr,
        },
        "model_config_fingerprint": gpu.get("config_fingerprint"),
    }


def summary(s):
    from app.services.review_service import pending_review_condition

    return {
        "run_total": s.scalar(select(func.count()).select_from(QualityRun)),
        "report_total": s.scalar(select(func.count()).select_from(Report)),
        "review_pending": s.scalar(
            select(func.count())
            .select_from(ModuleResult)
            .where(pending_review_condition())
        ),
        "running_runs": s.scalar(
            select(func.count())
            .select_from(QualityRun)
            .where(QualityRun.status == "running")
        ),
    }
