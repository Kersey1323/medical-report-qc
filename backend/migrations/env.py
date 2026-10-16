from alembic import context
from sqlalchemy import create_engine
from app.core.config import get_settings
from app.db.models import Base

url = context.config.attributes.get("url") or get_settings().database_url
if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(url, hide_parameters=True).connect() as conn:
        context.configure(connection=conn, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
