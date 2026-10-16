import re
from difflib import SequenceMatcher
from uuid import uuid4
from contracts.retrieval import EvidenceSnapshot
from app.core.exceptions import fail


def duplicate_filter_reason(source, candidate):
    s = re.sub(r"\s+", "", source)
    c = re.sub(r"\s+", "", candidate)
    similarity = SequenceMatcher(None, s, c).ratio()
    if s == c:
        return "exact_source_match", similarity
    if s in c or c in s:
        return "source_containment", similarity
    return ("near_duplicate_source" if similarity >= 0.95 else None), similarity


def filter_candidates(source, candidates):
    out = []
    for c in candidates:
        reason, sim = duplicate_filter_reason(source, c.text)
        out.append(c.model_copy(update={"filter_reason": reason, "similarity": sim}))
    return out


def select_evidence(candidate_set, branch, top_k):
    candidates = sorted(
        candidate_set.candidates,
        key=lambda c: (c.rerank_rank or c.recall_rank, c.candidate_id),
    )
    if not any(c.filter_reason is None for c in candidates):
        raise fail("no_valid_evidence", "过滤后没有可用证据", "retrieval.filter")
    rank = 0
    result = []
    for c in candidates:
        used = c.filter_reason is None and rank < top_k
        if used:
            rank += 1
        result.append(
            EvidenceSnapshot(
                id=str(uuid4()),
                branch=branch,
                candidate=c,
                used=used,
                used_rank=rank if used else None,
            )
        )
    return result
