"""
Common pytest fixture collection.

Note: Tests can only run inside a Docker container (timescaledb host accessible) or
when a local PostgreSQL is specified via the DATABASE_URL environment variable.
Run: docker compose exec backend pytest -v
"""
import asyncio

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.main import app
from app.models.esp_data import EspDailyData
from app.models.well import Well

# Dedicated well name for tests — prevents collision with production data
TEST_WELL_NAME = "TEST-UPLOAD-WELL"


# ============================================================
# Event loop (session scope)
# ============================================================

@pytest.fixture(scope="session")
def event_loop():
    """
    Share a single event loop across the entire test session.

    The pytest-asyncio default (function scope) creates a new loop per test,
    but the FastAPI app's global async_engine may hold connections from a
    previous loop. Reusing the engine on a new loop causes asyncpg
    InterfaceError. Pinning the loop to session scope keeps the engine
    connection pool valid throughout the session.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


# ============================================================
# Internal utilities
# ============================================================

async def _delete_well_by_name(session: AsyncSession, well_name: str) -> None:
    """
    Delete the well with the given name and its associated ESP data.
    Respects FK constraint order: esp_daily_data → wells.
    Does nothing if the well does not exist (idempotent).
    """
    result = await session.execute(select(Well.id).where(Well.name == well_name))
    well_id = result.scalar_one_or_none()
    if well_id:
        await session.execute(
            delete(EspDailyData).where(EspDailyData.well_id == well_id)
        )
        await session.execute(delete(Well).where(Well.id == well_id))
    await session.commit()


# ============================================================
# HTTP client fixture
# ============================================================

@pytest_asyncio.fixture
async def client() -> AsyncClient:
    """
    httpx AsyncClient — calls the FastAPI ASGI app directly.
    No real network required, making tests fast and free from port conflicts.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c


# ============================================================
# Well cleanup fixture
# ============================================================

@pytest_asyncio.fixture
async def cleanup_test_well():
    """
    Clean up TEST_WELL_NAME well data before and after each test.

    Key design decisions:
    - A dedicated independent engine is created for cleanup to avoid
      connection conflicts with the app's AsyncSessionLocal (global engine).
    - Each cleanup call creates and closes its own session for clean connections.
    - Safe to run even if residual data remains from a previously failed test.
    """
    async def _cleanup(well_name: str = TEST_WELL_NAME) -> None:
        # Create a dedicated engine separate from the app engine (prevents asyncpg connection conflicts)
        engine = create_async_engine(settings.DATABASE_URL)
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            await _delete_well_by_name(session, well_name)
        await engine.dispose()

    # Before test: remove residual data from previously failed tests
    await _cleanup()
    yield _cleanup  # Test can also call with a different name if needed
    # After test: remove data created during this test
    await _cleanup()
