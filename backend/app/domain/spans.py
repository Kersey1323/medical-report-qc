import re
from dataclasses import dataclass
from contracts.inference import SourceSpan
from app.domain.edits import SourceEdit
from app.core.exceptions import fail


@dataclass
class SpanResolution:
    spans: list
    candidate_spans: list
    ambiguous: bool


@dataclass
class ModelView:
    original: str
    text: str
    offset_map: list


@dataclass
class MappedEdits:
    edits: list
    ambiguous: bool
    whitespace_only: bool


def validate_span(source, span):
    if (
        span.start < 0
        or span.end > len(source)
        or source[span.start : span.end] != span.text
    ):
        raise fail(
            "response_invalid", "模型返回的原文区间无法校验", "span.validate", True
        )


def resolve_fragment(source, fragment):
    if not fragment:
        raise fail("response_invalid", "定位片段为空", "span.resolve", True)
    positions = []
    start = 0
    while True:
        i = source.find(fragment, start)
        if i < 0:
            break
        positions.append(SourceSpan(start=i, end=i + len(fragment), text=fragment))
        start = i + 1
    if not positions:
        raise fail("response_invalid", "定位片段不在医生原文中", "span.resolve", True)
    return SpanResolution(
        positions if len(positions) == 1 else [],
        positions if len(positions) > 1 else [],
        len(positions) > 1,
    )


def to_single_line(source):
    chars = []
    offsets = []
    i = 0
    while i < len(source):
        if source[i] in "\r\n":
            j = i + 1
            while j < len(source) and source[j] in "\r\n":
                j += 1
            chars.append(" ")
            offsets.append((i, j))
            i = j
        else:
            chars.append(source[i])
            offsets.append((i, i + 1))
            i += 1
    return ModelView(source, "".join(chars), offsets)


def map_model_edits(view, edits):
    out = []
    ambiguous = False
    whitespace_only = True
    for edit in edits:
        if re.sub(r"\s", "", edit.before) == re.sub(r"\s", "", edit.after):
            continue
        whitespace_only = False
        if edit.start == edit.end:
            start = (
                view.offset_map[edit.start][0]
                if edit.start < len(view.offset_map)
                else len(view.original)
            )
            end = start
        else:
            start = view.offset_map[edit.start][0]
            end = view.offset_map[edit.end - 1][1]
        if any(b - a > 1 for a, b in view.offset_map[edit.start : edit.end]):
            ambiguous = True
        out.append(SourceEdit(start, end, view.original[start:end], edit.after))
    return MappedEdits(out, ambiguous, whitespace_only)
