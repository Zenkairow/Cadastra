import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
import tempfile
import os
from web3 import Web3

from backend.app.database import Base
from backend.app.models.models import Jurisdiction
from indexer.service import EventIndexer

TEST_DB_FILE = os.path.join(tempfile.gettempdir(), "test_land_registry_indexer.db")
TEST_DB_URL = f"sqlite+aiosqlite:///{TEST_DB_FILE}"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
TestingSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False
)

@pytest_asyncio.fixture(scope="session", autouse=True)
async def init_indexer_test_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    if os.path.exists(TEST_DB_FILE):
        try:
            os.remove(TEST_DB_FILE)
        except Exception:
            pass

@pytest_asyncio.fixture(autouse=True)
async def clean_db_tables():
    async with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())

@pytest_asyncio.fixture
async def db_session():
    async with TestingSessionLocal() as session:
        # Seed test jurisdiction if not exists
        jur = await session.get(Jurisdiction, 101)
        if not jur:
            jur = Jurisdiction(
                id=101,
                name="Pune Haveli",
                state="Maharashtra",
                district="Pune"
            )
            session.add(jur)
            await session.commit()
        yield session

@pytest.fixture
def mock_w3():
    return Web3()

@pytest.fixture
def indexer_instance(mock_w3):
    return EventIndexer(w3=mock_w3)
