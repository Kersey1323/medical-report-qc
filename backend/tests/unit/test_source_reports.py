import json, hashlib
from retrieval_runtime.source_reports import SourceReportResolver


def test_only_verified_allowlist_mapping(tmp_path):
    p = tmp_path / "docs.json"
    p.write_text(json.dumps([{"doc_id": "a", "content": "甲乙丙"}]))
    r = SourceReportResolver([p])
    meta = {
        "doc_id": "a",
        "hash": hashlib.md5("甲乙".encode()).hexdigest(),
        "path": "/etc/passwd",
    }
    out = r.resolve("n", meta, "甲乙")
    assert out["text"] == "甲乙丙" and out["record"] == 0
    assert r.resolve("n", meta, "其他") is None
    assert r.resolve("n", {"doc_id": "unknown"}, "甲") is None
