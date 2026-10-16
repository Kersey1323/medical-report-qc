"""Read-only direct cache -> actual LlamaIndex vector/BM25, never re-embeds corpus.
Fusion rules ported from rag-optimizer fusion_retrieval.py, source hash in manifest.
Heavy dependencies are imported only when retrieval runtime explicitly loads.
"""

import hashlib, json, math
from pathlib import Path
from contracts.retrieval import Candidate
from app.core.exceptions import fail


class HybridIndex:
    def __init__(self):
        self.nodes = []
        self.vector = None
        self.keyword = None
        self.fingerprint = None
        self.resolver = None

    def restore(self, path, embedder, dimension=1024):
        from llama_index.core import VectorStoreIndex
        from llama_index.core.schema import TextNode
        from llama_index.retrievers.bm25 import BM25Retriever

        path = Path(path)
        if not path.is_file():
            raise fail(
                "index_missing", "医学索引文件不存在，禁止重建", "retrieval.load"
            )
        self.fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
        data = json.loads(path.read_text())
        chunks = data.get("corpus_chunks", [])
        if not chunks:
            raise fail("index_empty", "索引无节点", "retrieval.load")
        seen = set()
        self.by_id = {}
        for c in chunks:
            id = c["chunk_id"]
            v = c.get("embedding")
            text = c.get("text", "")
            meta = c.get("metadata") or {}
            if (
                id in seen
                or not text.strip()
                or not isinstance(v, list)
                or len(v) != dimension
                or any(type(x) not in (int, float) or not math.isfinite(x) for x in v)
            ):
                raise fail(
                    "index_invalid",
                    "索引存在重复节点、空文本或向量维度/坏值",
                    "retrieval.load",
                )
            seen.add(id)
            # Keep text exactly as indexed. Metadata is a snapshot, never executable paths.
            node = TextNode(id_=id, text=text, embedding=v, metadata=meta)
            self.nodes.append(node)
            self.by_id[id] = node
        self.vector = VectorStoreIndex(nodes=self.nodes, embed_model=embedder)
        self.keyword = BM25Retriever.from_defaults(
            nodes=self.nodes, similarity_top_k=25, language="zh"
        )

    def retrieve(self, source, limit=20):
        from llama_index.core.schema import QueryBundle

        # Matches _retrieve_component_results(top_k=20), weighted RRF + consensus.
        paths = {
            "embedding": self.vector.as_retriever(
                similarity_top_k=max(25, limit)
            ).retrieve(QueryBundle(source))[:limit],
            "keyword": self.keyword.retrieve(source)[:limit],
        }
        fused = {}
        for name, values in paths.items():
            weight = 0.6 if name == "embedding" else 0.4
            for rank, n in enumerate(values, 1):
                item = fused.setdefault(
                    n.node.node_id, {"node": n.node, "score": 0, "sources": set()}
                )
                item["score"] += weight / (60 + rank)
                item["sources"].add(name)
        for item in fused.values():
            if len(item["sources"]) == 2:
                item["score"] += 0.05
        ordered = sorted(fused.values(), key=lambda item: -item["score"])[:limit]
        result = []
        for i, item in enumerate(ordered, 1):
            n = item["node"]
            m = n.metadata
            # Full report requires explicit verified mapping. Historical chunks do not
            # carry a verifiable original-report hash, so remain indexed_chunk.
            resolved = (
                self.resolver.resolve(n.node_id, m, n.text) if self.resolver else None
            )
            result.append(
                Candidate(
                    candidate_id=n.node_id,
                    node_id=n.node_id,
                    doc_id=m.get("doc_id") or m.get("source_doc_id"),
                    text=n.text,
                    content_scope="report"
                    if resolved and resolved["text"] == n.text
                    else "indexed_chunk",
                    full_report_text=resolved["text"] if resolved else None,
                    provenance={
                        "metadata": m,
                        "index_fingerprint": self.fingerprint,
                        "recall_sources": sorted(item["sources"]),
                        "source_report": {
                            k: v for k, v in resolved.items() if k != "text"
                        }
                        if resolved
                        else None,
                    },
                    recall_rank=i,
                    recall_score=item["score"],
                )
            )
        return result
