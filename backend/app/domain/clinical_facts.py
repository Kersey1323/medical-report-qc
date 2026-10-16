"""Conservative review flags, not a medical semantic-equivalence validator."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class FactChange:
    kind: str
    before: str
    after: str


PATTERNS = {
    "laterality": r"左侧|右侧|双侧|双肺|左|右",
    "measurements": r"\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米|个|枚|%|HU)?",
    "negation": r"未见|未|无|否认|阴性|阳性|不伴|伴有",
    "anatomy": r"肺|肝|肾|胰|脾|胃|肠|心|胸膜|胸腔|腹腔|脑|椎|骨|胆囊|甲状腺",
    "attributes": r"实性|磨玻璃|钙化|囊性|高密度|低密度|增大|缩小",
}


def detect_fact_changes(source, suggestion):
    out = []
    for kind, p in PATTERNS.items():
        before = re.findall(p, source)
        after = re.findall(p, suggestion)
        if before != after:
            out.append(FactChange(kind, " / ".join(before), " / ".join(after)))
    return out
