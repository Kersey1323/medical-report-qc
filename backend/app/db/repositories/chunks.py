from sqlalchemy import select
from app.db.models import CscChunk


class CscChunkStore:
    def __init__(self, factory):
        self.factory = factory

    def load(self, module_result_id, config_hash):
        with self.factory() as s:
            return [
                r.data
                for r in s.scalars(
                    select(CscChunk).where(
                        CscChunk.module_result_id == str(module_result_id),
                        CscChunk.config_hash == config_hash,
                    )
                )
            ]

    def save(self, module_result_id, config_hash, result):
        with self.factory.begin() as s:
            row = s.scalar(
                select(CscChunk)
                .where(
                    CscChunk.module_result_id == str(module_result_id),
                    CscChunk.config_hash == config_hash,
                    CscChunk.chunk_key == result["chunk"]["key"],
                )
                .with_for_update()
            )
            if row:
                row.data = result
            else:
                s.add(
                    CscChunk(
                        module_result_id=str(module_result_id),
                        config_hash=config_hash,
                        chunk_key=result["chunk"]["key"],
                        data=result,
                    )
                )
