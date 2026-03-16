"""add slope_norm columns to trend_residual_scores

MA30 기울기 정규화 이탈도 컬럼 3개 추가.
slope_norm = slope_30 / slope_baseline (부호 포함)
  - 양수 = 상승 트렌드, 음수 = 하락 트렌드
  - 크기 ~1.0 = 보통 추세, ~2.0 이상 = 강한 추세

Revision ID: 011
Revises: 010
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trend_residual_scores", sa.Column("slope_norm_eta",   sa.Float(), nullable=True))
    op.add_column("trend_residual_scores", sa.Column("slope_norm_v_std", sa.Float(), nullable=True))
    op.add_column("trend_residual_scores", sa.Column("slope_norm_t_eff", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("trend_residual_scores", "slope_norm_t_eff")
    op.drop_column("trend_residual_scores", "slope_norm_v_std")
    op.drop_column("trend_residual_scores", "slope_norm_eta")
