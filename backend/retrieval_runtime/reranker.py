import math
import httpx
from app.clients.http import unwrap
from app.core.exceptions import fail
from app.services.common import digest


def validate_rerank(candidates, items):
    if len(items) != len(candidates):
        raise fail("rerank_invalid", "重排返回数量不完整", "retrieval.rerank", True)
    seen = set()
    out = []
    for item in items:
        index = item.get("index")
        score = item.get("score")
        if (
            type(index) is not int
            or not 0 <= index < len(candidates)
            or index in seen
            or item.get("candidate_id") != candidates[index].candidate_id
            or type(score) not in (float, int)
            or not math.isfinite(score)
        ):
            raise fail(
                "rerank_invalid", "重排ID、索引或得分无效", "retrieval.rerank", True
            )
        seen.add(index)
        out.append(candidates[index].model_copy(update={"rerank_score": float(score)}))
    out.sort(key=lambda c: (-c.rerank_score, c.recall_rank, c.candidate_id))
    return [c.model_copy(update={"rerank_rank": i}) for i, c in enumerate(out, 1)]


class CpuReranker:
    def __init__(self, url, http, headers=None, expected_identity=None):
        self.expected_identity = expected_identity
        self.url = url
        self.http = http
        self.headers = headers or {}

    def score(self, source, candidates, fingerprint):
        data = unwrap(
            self.http.post(
                self.url + "/internal/v1/rerank",
                json={
                    "source": source,
                    "candidates": [
                        {
                            "candidate_id": c.candidate_id,
                            "text": c.text,
                            "recall_rank": c.recall_rank,
                        }
                        for c in candidates
                    ],
                    "config_fingerprint": fingerprint,
                },
                headers=self.headers,
                timeout=120,
            ),
            "retrieval.rerank",
        )
        if self.expected_identity is not None and digest(
            data.get("identity")
        ) != digest(self.expected_identity):
            raise fail(
                "retrieval_identity_mismatch",
                "重排模型身份发生变化",
                "retrieval.rerank",
            )
        return validate_rerank(candidates, data["candidates"])
