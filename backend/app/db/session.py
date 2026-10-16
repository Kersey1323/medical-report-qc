from contextlib import contextmanager
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings


@lru_cache
def get_factory(url=None):
    engine = create_engine(
        url or get_settings().database_url,
        pool_pre_ping=True,
        pool_recycle=1800,
        hide_parameters=True,
    )
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def session_scope():
    with get_factory()() as s:
        with s.begin():
            yield s
