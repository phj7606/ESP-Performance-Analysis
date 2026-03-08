"""
rul_predictions 테이블에 물리 기반 예측 컬럼 추가.

OLS+PI 방식(Prophet 대체) 전환으로 신규 필드 필요:
  - model_type:            선택된 회귀 모델 종류 (linear / exponential)
  - regression_window:     회귀에 사용된 열화 구간 데이터 수 (일)
  - decline_factor:        베이스라인 대비 임계 하락 비율 (예: 0.20 = 20%)
  - baseline_eta:          베이스라인 구간 eta_proxy 평균값
  - failure_threshold_eta: 실제 물리적 임계치 절대값 (baseline_eta × (1-decline_factor))
  - forecast_data:         [{date, eta_p10, eta_p50, eta_p90}, ...] JSONB 예측 궤적

Revision ID: 007
Revises: 006
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# Alembic 메타데이터
revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rul_predictions",
        sa.Column("model_type", sa.String(20), nullable=True,
                  comment="선택된 회귀 모델: linear | exponential"),
    )
    op.add_column(
        "rul_predictions",
        sa.Column("regression_window", sa.Integer(), nullable=True,
                  comment="회귀에 사용된 열화 구간 N일"),
    )
    op.add_column(
        "rul_predictions",
        sa.Column("decline_factor", sa.Float(), nullable=True,
                  comment="베이스라인 대비 임계 하락 비율 (0.20 = 20%)"),
    )
    op.add_column(
        "rul_predictions",
        sa.Column("baseline_eta", sa.Float(), nullable=True,
                  comment="베이스라인 구간 eta_proxy_ma30 평균"),
    )
    op.add_column(
        "rul_predictions",
        sa.Column("failure_threshold_eta", sa.Float(), nullable=True,
                  comment="실제 물리적 임계치 = baseline_eta × (1 - decline_factor)"),
    )
    op.add_column(
        "rul_predictions",
        sa.Column("forecast_data", JSONB(), nullable=True,
                  comment="예측 궤적: [{date, eta_p10, eta_p50, eta_p90}]"),
    )


def downgrade() -> None:
    op.drop_column("rul_predictions", "forecast_data")
    op.drop_column("rul_predictions", "failure_threshold_eta")
    op.drop_column("rul_predictions", "baseline_eta")
    op.drop_column("rul_predictions", "decline_factor")
    op.drop_column("rul_predictions", "regression_window")
    op.drop_column("rul_predictions", "model_type")
