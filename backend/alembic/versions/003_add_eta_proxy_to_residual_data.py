"""residual_data 테이블에 효율 Proxy 컬럼 추가

Revision ID: 003
Revises: 002
Create Date: 2026-03-06

추가 컬럼:
  eta_proxy      — (pd-pi) / motor_power: 단위 전력당 차압, 펌프 효율 proxy
  eta_proxy_ma30 — eta_proxy 30일 이동 평균
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # nullable=True: 기존 행 호환성 유지, motor_power=0인 날 NaN → NULL 저장
    for col in ["eta_proxy", "eta_proxy_ma30"]:
        op.add_column(
            "residual_data",
            sa.Column(col, sa.Float(), nullable=True),
        )


def downgrade() -> None:
    for col in ["eta_proxy_ma30", "eta_proxy"]:
        op.drop_column("residual_data", col)
