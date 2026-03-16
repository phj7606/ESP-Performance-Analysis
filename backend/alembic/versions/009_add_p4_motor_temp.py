"""
pillar_results 테이블에 Pillar 4 (모터 온도) 컬럼 추가.

Pillar 4 (Thermal): motor_temp 7일 이동 중앙값 기반 온도 알람
  WARNING:  7일 이동 중앙값 ≥ 130°C
  CRITICAL: 7일 이동 중앙값 ≥ 150°C

Revision ID: 009
Revises: 008
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa

# Alembic 메타데이터
revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pillar_results 테이블에 Pillar 4 컬럼 3개 추가
    op.add_column(
        "pillar_results",
        sa.Column("p4_status", sa.String(20), nullable=True, server_default="unknown"),
    )
    op.add_column(
        "pillar_results",
        sa.Column("p4_current_val", sa.Float(), nullable=True),
    )
    op.add_column(
        "pillar_results",
        sa.Column("p4_data_available", sa.Boolean(), nullable=True, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("pillar_results", "p4_data_available")
    op.drop_column("pillar_results", "p4_current_val")
    op.drop_column("pillar_results", "p4_status")
