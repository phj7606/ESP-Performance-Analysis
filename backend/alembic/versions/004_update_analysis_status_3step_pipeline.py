"""
3-Step 파이프라인 마이그레이션

변경 내용:
1. analysis_status CHECK 제약 업데이트
   - 제거: baseline_set, residual_done, rul_done
   - 추가: diagnosis_done, health_done
2. rul_predictions 테이블에서 wiener_drift, wiener_diffusion 컬럼 제거
3. residual_data 테이블에 4개 무차원 지수 컬럼 추가 (기존 없는 경우)
4. 기존 데이터 마이그레이션: 구 상태값 → 신 상태값

Revision ID: 004
Revises: 003
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. 기존 상태값 마이그레이션 (CHECK 제약 추가 전에 먼저 실행) ──
    # baseline_set, residual_done → diagnosis_done (Step 1 완료와 동등)
    # rul_done → health_done (Step 2 완료와 동등)
    op.execute(
        "ALTER TABLE wells DROP CONSTRAINT IF EXISTS wells_analysis_status_check"
    )
    op.execute(
        """
        UPDATE wells
        SET analysis_status = 'diagnosis_done'
        WHERE analysis_status IN ('baseline_set', 'residual_done')
        """
    )
    op.execute(
        """
        UPDATE wells
        SET analysis_status = 'health_done'
        WHERE analysis_status = 'rul_done'
        """
    )

    # ── 2. 새 CHECK 제약 추가 (데이터 마이그레이션 완료 후) ────────
    op.execute(
        """
        ALTER TABLE wells ADD CONSTRAINT wells_analysis_status_check
        CHECK (analysis_status IN (
            'no_data',
            'data_ready',
            'diagnosis_done',
            'health_done',
            'fully_analyzed'
        ))
        """
    )

    # ── 3. rul_predictions wiener 컬럼 제거 ──────────────────
    op.execute(
        "ALTER TABLE rul_predictions DROP COLUMN IF EXISTS wiener_drift"
    )
    op.execute(
        "ALTER TABLE rul_predictions DROP COLUMN IF EXISTS wiener_diffusion"
    )

    # ── 4. residual_data 무차원 지수 컬럼 추가 ───────────────
    # 기존 마이그레이션(002/003)에서 이미 추가된 컬럼은 IF NOT EXISTS로 스킵
    for col in ["cp", "psi", "v_std", "t_eff", "eta_proxy",
                "cp_ma30", "psi_ma30", "v_std_ma30", "t_eff_ma30", "eta_proxy_ma30"]:
        op.execute(
            f"ALTER TABLE residual_data ADD COLUMN IF NOT EXISTS {col} FLOAT"
        )


def downgrade() -> None:
    # ── 1. analysis_status CHECK 되돌리기 ─────────────────────
    op.execute(
        "ALTER TABLE wells DROP CONSTRAINT IF EXISTS wells_analysis_status_check"
    )
    op.execute(
        """
        ALTER TABLE wells ADD CONSTRAINT wells_analysis_status_check
        CHECK (analysis_status IN (
            'no_data',
            'data_ready',
            'baseline_set',
            'residual_done',
            'rul_done',
            'fully_analyzed'
        ))
        """
    )

    # ── 2. rul_predictions wiener 컬럼 복원 ──────────────────
    op.execute(
        "ALTER TABLE rul_predictions ADD COLUMN IF NOT EXISTS wiener_drift FLOAT"
    )
    op.execute(
        "ALTER TABLE rul_predictions ADD COLUMN IF NOT EXISTS wiener_diffusion FLOAT"
    )
