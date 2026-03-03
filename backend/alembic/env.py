import asyncio
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context

from app.core.config import settings
from app.db.database import Base

# alembic.ini 로거 설정 적용
config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ORM 모델 메타데이터 (자동 마이그레이션 감지용)
# 모든 모델을 임포트해야 메타데이터가 올바르게 채워짐
from app.models.well import Well  # noqa: F401
from app.models.esp_data import EspDailyData  # noqa: F401
from app.models.analysis import (  # noqa: F401
    AnalysisSession, BaselinePeriod, ResidualData, RulPrediction, HealthScore
)

target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):
    """
    esp_daily_data는 init.sql에서 직접 생성 + TimescaleDB hypertable 변환.
    Alembic이 이를 관리하면 hypertable 설정이 덮어써지므로 제외.
    """
    if type_ == "table" and name == "esp_daily_data":
        return False
    return True


def run_migrations_offline() -> None:
    """오프라인 모드: DB 연결 없이 SQL 스크립트만 생성"""
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """온라인 모드: 비동기 엔진으로 실제 DB에 마이그레이션 적용"""
    connectable = create_async_engine(settings.DATABASE_URL)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
