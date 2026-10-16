from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from contracts.retrieval import Candidate


def test_distinct_retrieval_requests_wait_serially_instead_of_failing_busy(monkeypatch):
    import retrieval_runtime.main as runtime

    entered = Event()
    release = Event()

    class Index:
        fingerprint = "test-index"
        nodes = [1]

        def restore(self, *args):
            pass

        def retrieve(self, source, k):
            if source == "合成A":
                entered.set()
                assert release.wait(5)
            return [
                Candidate(
                    candidate_id=source,
                    node_id=source,
                    text="独立合成参考报告正文",
                    recall_rank=1,
                )
            ]

    class Reranker:
        def __init__(self, *args):
            pass

        def score(self, source, candidates, fp):
            return candidates

    class Http:
        def __init__(self, *a, **kw):
            pass

        def get(self, *a, **kw):
            return None

        def close(self):
            pass

    from app.core.config import get_settings
    import yaml

    cfg = yaml.safe_load(get_settings().retrieval_config_file.read_text())
    monkeypatch.setattr(
        runtime, "httpx", SimpleNamespace(Client=Http, HTTPTransport=lambda **kw: None)
    )
    monkeypatch.setattr(
        runtime,
        "unwrap",
        lambda *a: {
            "cpu_models": {
                "models": [
                    {
                        "role": "embedding",
                        "digest": cfg["embedding"]["expected_digest"],
                        "dimension": 1024,
                    },
                    {"role": "reranker", "path_or_model": "synthetic"},
                ],
                "config_fingerprint": "test",
            }
        },
    )
    monkeypatch.setattr(runtime, "HybridIndex", Index)
    monkeypatch.setattr(runtime, "CpuReranker", Reranker)
    monkeypatch.setattr(runtime, "make_embedder", lambda *a: None)
    monkeypatch.setattr(get_settings(), "allow_unknown_embedding_provenance", True)
    with TestClient(runtime.create_app()) as client, ThreadPoolExecutor(2) as pool:

        def request(source):
            from uuid import uuid4

            return client.post(
                "/internal/v1/retrieve",
                json={
                    "request_id": str(uuid4()),
                    "source": source,
                    "config_fingerprint": __import__(
                        "app.services.common", fromlist=["digest"]
                    ).digest(cfg),
                },
            ).json()

        bad = client.post(
            "/internal/v1/retrieve",
            json={
                "request_id": str(__import__("uuid").uuid4()),
                "source": "合成配置漂移",
                "config_fingerprint": "unrelated",
            },
        ).json()
        assert (
            bad["status"] == "error"
            and bad["detail"]["code"] == "retrieval_identity_mismatch"
        )
        health = client.get("/health/ready").json()["data"]
        assert health["config_fingerprint"] == __import__(
            "app.services.common", fromlist=["digest"]
        ).digest(cfg)
        assert health["cpu_fingerprint"] == "test"
        first = pool.submit(request, "合成A")
        assert entered.wait(3)
        second = pool.submit(request, "合成B")
        import time

        time.sleep(0.1)
        assert not second.done()
        release.set()
        assert first.result(5)["status"] == "success"
        assert second.result(5)["status"] == "success"
