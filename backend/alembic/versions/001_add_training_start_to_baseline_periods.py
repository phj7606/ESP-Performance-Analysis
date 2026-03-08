"""baseline_periods 테이블에 training_start 컬럼 추가

Revision ID: 001
Revises:
Create Date: 2026-03-04

training_start: choke/vfd_freq 조절 이벤트 자동 감지 또는 수동 입력으로 설정되는
                Ridge 회귀 모델 학습 시작 날짜
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # baseline_periods 테이블에 training_start DATE 컬럼 추가
    # nullable=True: 기존 데이터 호환성 유지 (기존 행은 NULL로 채워짐)
    op.add_column(
        "baseline_periods",
        sa.Column("training_start", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    # 롤백 시 컬럼 제거
    op.drop_column("baseline_periods", "training_start")
