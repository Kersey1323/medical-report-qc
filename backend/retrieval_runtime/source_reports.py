"""Only explicitly configured corpus files can supply historical full reports."""

from pathlib import Path
import json, hashlib


class SourceReportResolver:
    def __init__(self, files):
        self.reports = {}
        for configured in files:
            path = Path(configured).resolve(strict=True)
            raw = path.read_bytes()
            file_hash = hashlib.sha256(raw).hexdigest()
            rows = json.loads(raw)
            if not isinstance(rows, list):
                raise ValueError("corpus must contain document records")
            for index, row in enumerate(rows):
                if (
                    not isinstance(row, dict)
                    or not isinstance(row.get("doc_id"), str)
                    or not isinstance(row.get("content"), str)
                ):
                    continue
                if row["doc_id"] in self.reports:
                    raise ValueError("ambiguous duplicate report ID")
                self.reports[row["doc_id"]] = {
                    "text": row["content"],
                    "doc_id": row["doc_id"],
                    "corpus": path.parent.name,
                    "file": str(path),
                    "record": index,
                    "content_hash": hashlib.sha256(row["content"].encode()).hexdigest(),
                    "file_hash": file_hash,
                }

    def resolve(self, node_id, metadata, retrieved_text):
        doc_id = metadata.get("doc_id") or metadata.get("source_doc_id")
        source = self.reports.get(doc_id)
        if not source:
            return None
        # MD5 is a legacy content-integrity check, never an identity credential.
        if (
            metadata.get("hash")
            and hashlib.md5(retrieved_text.encode()).hexdigest() != metadata["hash"]
        ):
            return None
        if retrieved_text not in source["text"]:
            return None
        return dict(source)
