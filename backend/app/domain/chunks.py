from dataclasses import dataclass
from app.core.exceptions import fail
from app.services.common import digest


@dataclass(frozen=True)
class SourceChunk:
    key: str
    start: int
    end: int
    text: str


def split_source(source, max_length=128):
    if not source or not source.strip():
        raise fail("input_validation_error", "原描述为空", "csc.split")
    if not 1 <= max_length <= 128:
        raise ValueError("CSC block max length 1..128")
    chunks = []
    start = 0
    while start < len(source):
        end = min(start + max_length, len(source))
        if end < len(source):
            window = source[start:end]
            for punctuation in ("。！？!?\n", "；;", "，,、"):
                cut = max((window.rfind(c) for c in punctuation), default=-1)
                if cut >= 0:
                    end = start + cut + 1
                    break
        chunks.append(
            SourceChunk(
                f"{start}:{end}:{digest(source[start:end])[:12]}",
                start,
                end,
                source[start:end],
            )
        )
        start = end
    return chunks
