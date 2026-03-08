from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# Create async engine (uses asyncpg driver)
async_engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    # Enable SQL logging only during development
    echo=False,
)

# Session factory: expire_on_commit=False → ORM objects remain accessible after commit
AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Common base class for all SQLAlchemy ORM models"""
    pass


async def get_db():
    """DB session generator for FastAPI dependency injection"""
    async with AsyncSessionLocal() as session:
        yield session
