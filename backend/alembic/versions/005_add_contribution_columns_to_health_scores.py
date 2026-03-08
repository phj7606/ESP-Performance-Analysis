"""
health_scores 테이블에 피처 기여도 컬럼 3개 추가.

EWMA 전처리 + Rolling GMM 피처 기여도 분석 기능 추가에 따라
hover 인터랙션 시 실시간 GMM 재계산 없이 조회할 수 있도록 DB에 저장.

Revision ID: 005
Revises: 004
Create Date: 2026-03-07
"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('health_scores', sa.Column('contribution_eta',   sa.Float(), nullable=True))
    op.add_column('health_scores', sa.Column('contribution_v_std', sa.Float(), nullable=True))
    op.add_column('health_scores', sa.Column('contribution_t_eff', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('health_scores', 'contribution_t_eff')
    op.drop_column('health_scores', 'contribution_v_std')
    op.drop_column('health_scores', 'contribution_eta')
