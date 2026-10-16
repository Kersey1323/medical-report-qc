from uuid import uuid4
import pytest, math
from contracts.retrieval import Candidate, CandidateSet
from retrieval_runtime.filtering import (
    duplicate_filter_reason,
    filter_candidates,
    select_evidence,
)
from retrieval_runtime.reranker import validate_rerank
from app.core.exceptions import AppError


def candidates(n=20):
    return [
        Candidate(
            candidate_id=str(i), node_id=str(i), text="报告" + str(i), recall_rank=i + 1
        )
        for i in range(n)
    ]


def test_filters_and_independent_top_k():
    assert duplicate_filter_reason("甲 乙", "甲乙")[0] == "exact_source_match"
    assert duplicate_filter_reason("甲乙丙", "甲乙")[0] == "source_containment"
    c = CandidateSet(
        candidates=filter_candidates("肺炎未见", candidates()),
        index_fingerprint="i",
        embedding_fingerprint="e",
        config_fingerprint="c",
    )
    assert sum(e.used for e in select_evidence(c, "cgec", 5)) == 5
    assert sum(e.used for e in select_evidence(c, "rag", 10)) == 10
    assert len(select_evidence(c, "rag", 10)) == 20


@pytest.mark.parametrize(
    "result",
    [
        [],
        [{"candidate_id": "0", "index": 0, "score": math.nan}],
        [{"candidate_id": "0", "index": 0, "score": 0.8}] * 2,
    ],
)
def test_bad_rerank_never_falls_back(result):
    with pytest.raises(AppError):
        validate_rerank(candidates(2), result)
