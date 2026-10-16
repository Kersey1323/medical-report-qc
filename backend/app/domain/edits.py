from dataclasses import dataclass, asdict
from difflib import SequenceMatcher


@dataclass(frozen=True)
class SourceEdit:
    start: int
    end: int
    before: str
    after: str

    def model_dump(self):
        return asdict(self)


def diff_edits(source, suggestion):
    return [
        SourceEdit(i, j, source[i:j], suggestion[a:b])
        for op, i, j, a, b in SequenceMatcher(
            None, source, suggestion, autojunk=False
        ).get_opcodes()
        if op != "equal"
    ]
