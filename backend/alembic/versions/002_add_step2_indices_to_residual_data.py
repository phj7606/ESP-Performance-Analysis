"""residual_data 테이블에 Step 2 무차원 성능 지수 컬럼 추가

Revision ID: 002
Revises: 001
Create Date: 2026-03-06

추가 컬럼:
  cp, psi, v_std, t_eff      — 4개 무차원 성능 지수 (날 단위)
  cp_ma30, psi_ma30,         — 각 지수의 30일 이동 평균
  v_std_ma30, t_eff_ma30

기존 컬럼 유지:
  residual     — 1 - (ψ / ψ_baseline_mean): Step 3 RUL 입력용으로 재활용
  residual_ma30 — 위의 30일 MA
  predicted, actual, degradation_rate — NULL 저장 (하위 호환)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 4개 무차원 성능 지수 + 30일 MA 컬럼 추가
    # nullable=True: 기존 행 호환성 유지 및 분모=0 등 계산 불가 케이스 처리
    for col in ["cp", "psi", "v_std", "t_eff", "cp_ma30", "psi_ma30", "v_std_ma30", "t_eff_ma30"]:
        op.add_column(
            "residual_data",
            sa.Column(col, sa.Float(), nullable=True),
        )


def downgrade() -> None:
    # 롤백 시 추가 컬럼 제거 (추가 역순으로 삭제)
    for col in ["t_eff_ma30", "v_std_ma30", "psi_ma30", "cp_ma30", "t_eff", "v_std", "psi", "cp"]:
        op.drop_column("residual_data", col)
