from app.clients.http import unwrap
from app.core.exceptions import fail


def make_embedder(url, http, headers, expected_digest=None):
    from llama_index.core.embeddings import BaseEmbedding

    class ServiceEmbedding(BaseEmbedding):
        def _get_query_embedding(self, query):
            return self._get_text_embedding(query)

        def _get_text_embedding(self, text):
            data = unwrap(
                http.post(
                    url + "/internal/v1/embeddings",
                    json={"texts": [text]},
                    headers=headers,
                    timeout=130,
                ),
                "retrieval.embedding",
            )
            if (
                expected_digest
                and data.get("identity", {}).get("digest") != expected_digest
            ):
                raise fail(
                    "retrieval_identity_mismatch",
                    "查询embedding身份发生变化",
                    "retrieval.embedding",
                )
            vectors = data.get("embeddings")
            if data.get("dimension") != 1024 or not vectors or len(vectors[0]) != 1024:
                raise fail(
                    "embedding_invalid", "查询向量维度无效", "retrieval.embedding"
                )
            return vectors[0]

        async def _aget_query_embedding(self, query):
            import asyncio

            return await asyncio.to_thread(self._get_query_embedding, query)

    return ServiceEmbedding(model_name="bge-m3:latest", embed_batch_size=1)
