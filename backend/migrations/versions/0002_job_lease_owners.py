"""Fence import/export workers independently from their lease timestamps."""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("imports", "artifacts"):
        # 0001 used live metadata, so newly created databases may already contain it.
        if "lease_owner" not in {
            c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)
        }:
            op.add_column(table, sa.Column("lease_owner", sa.String(36), nullable=True))


def downgrade():
    for table in ("artifacts", "imports"):
        op.drop_column(table, "lease_owner")
