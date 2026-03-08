"""
pillar_results 테이블 신규 추가.

Step 3 분석 방식 변경:
  OLS+PI 기반 RUL 예측 → 3-Pillar 독립 고장 모드 알람 모니터링

Pillar 1 (Hydraulic): ψ_ma30 Mann-Kendall 하락 추세 + CRITICAL 임계치
Pillar 2 (Mechanical): v_std_ma30 Mann-Kendall 상승 추세 + CRITICAL 임계치
Pillar 3 (Electrical): current_leak 절대값 + 3일 지속 조건

기존 rul_predictions 테이블은 호환성 유지를 위해 삭제하지 않음.

Revision ID: 008
Revises: 007
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa

# Alembic 메타데이터
revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pillar_results",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("well_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
        # Pillar 1: Hydraulic
        sa.Column("p1_status",       sa.String(20), nullable=True),
        sa.Column("p1_tau",          sa.Float(),    nullable=True),
        sa.Column("p1_pvalue",       sa.Float(),    nullable=True),
        sa.Column("p1_current_val",  sa.Float(),    nullable=True),
        sa.Column("p1_baseline_val", sa.Float(),    nullable=True),
        sa.Column("p1_threshold",    sa.Float(),    nullable=True),
        # Pillar 2: Mechanical
        sa.Column("p2_status",       sa.String(20), nullable=True),
        sa.Column("p2_tau",          sa.Float(),    nullable=True),
        sa.Column("p2_pvalue",       sa.Float(),    nullable=True),
        sa.Column("p2_current_val",  sa.Float(),    nullable=True),
        sa.Column("p2_baseline_val", sa.Float(),    nullable=True),
        sa.Column("p2_threshold",    sa.Float(),    nullable=True),
        # Pillar 3: Electrical
        sa.Column("p3_status",         sa.String(20),  nullable=True),
        sa.Column("p3_current_val",    sa.Float(),     nullable=True),
        sa.Column("p3_days_exceeded",  sa.Integer(),   nullable=True),
        sa.Column("p3_data_available", sa.Boolean(),   nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["well_id"], ["wells.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_pillar_results_well_id", "pillar_results", ["well_id"])


def downgrade() -> None:
    op.drop_index("ix_pillar_results_well_id", table_name="pillar_results")
    op.drop_table("pillar_results")
