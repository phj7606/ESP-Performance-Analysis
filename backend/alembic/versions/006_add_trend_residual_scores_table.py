"""
trend_residual_scores 테이블 추가: Trend-Residual Health Scoring (Step 2-B).

MA30 기준선 + 잔차 σ 이탈 감점 + 기울기 감점 방식.
GMM(health_scores)과 독립된 별도 테이블로 두 방법의 독립성 유지.

Revision ID: 006
Revises: 005
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'trend_residual_scores',
        sa.Column('well_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('health_score',  sa.Float(), nullable=True),
        sa.Column('health_status', sa.String(20), nullable=True),
        sa.Column('score_eta',   sa.Float(), nullable=True),
        sa.Column('score_v_std', sa.Float(), nullable=True),
        sa.Column('score_t_eff', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ['well_id'], ['wells.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('well_id', 'date'),
    )


def downgrade() -> None:
    op.drop_table('trend_residual_scores')
