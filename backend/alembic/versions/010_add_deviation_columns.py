"""
trend_residual_scores 테이블에 방향성 Z-score deviation 컬럼 추가.

기존 health_score, score_eta, score_v_std, score_t_eff 컬럼은 유지 (데이터 보존).
신규 deviation 컬럼: MA30 대비 부호 포함 Z-score (Trend Analysis 알고리즘 전환).

Revision ID: 010
Revises: 009
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa

# Alembic 메타데이터
revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # trend_residual_scores 테이블에 deviation 컬럼 3개 추가
    op.add_column(
        "trend_residual_scores",
        sa.Column("deviation_eta", sa.Float(), nullable=True),
    )
    op.add_column(
        "trend_residual_scores",
        sa.Column("deviation_v_std", sa.Float(), nullable=True),
    )
    op.add_column(
        "trend_residual_scores",
        sa.Column("deviation_t_eff", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("trend_residual_scores", "deviation_t_eff")
    op.drop_column("trend_residual_scores", "deviation_v_std")
    op.drop_column("trend_residual_scores", "deviation_eta")
