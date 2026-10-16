import pytest
from app.domain.spans import (
    resolve_fragment,
    validate_span,
    to_single_line,
    map_model_edits,
)
from app.domain.edits import diff_edits
from app.domain.chunks import split_source
from app.domain.clinical_facts import detect_fact_changes
from contracts.inference import SourceSpan


def test_duplicate_nonbmp():
    r = resolve_fragment("𠮷灶。𠮷灶。", "𠮷灶")
    assert r.ambiguous and not r.spans
    assert [s.start for s in r.candidate_spans] == [0, 3]


def test_model_view():
    v = to_single_line("甲\r\n乙\n\n丙")
    assert v.text == "甲 乙 丙"
    out = map_model_edits(v, diff_edits(v.text, "甲 乙 丙。"))
    assert out.edits[-1].start == 7 and out.edits[-1].before == ""


@pytest.mark.parametrize("n", [1, 127, 128, 129, 694])
def test_full_coverage(n):
    s = ("𠮷。" * n)[:n]
    chunks = split_source(s)
    assert "".join(c.text for c in chunks) == s and all(
        len(c.text) <= 128 for c in chunks
    )
    assert chunks[0].start == 0 and chunks[-1].end == n


def test_clinical_guard():
    assert detect_fact_changes("左肺结节3mm", "右肺结节5mm")
    assert not detect_fact_changes("肺纹理清晰。", "肺纹理清晰，")
