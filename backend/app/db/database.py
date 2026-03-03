from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# 비동기 엔진 생성 (asyncpg 드라이버 사용)
async_engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    # SQL 로그는 개발 시에만 활성화
    echo=False,
)

# 세션 팩토리: expire_on_commit=False → 커밋 후에도 ORM 객체 접근 가능
AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """모든 SQLAlchemy ORM 모델의 공통 베이스 클래스"""
    pass


async def get_db():
    """FastAPI 의존성 주입용 DB 세션 생성기"""
    async with AsyncSessionLocal() as session:
        yield session
