"""
MongoDB connection using Motor (async driver).
Exposes get_db() for dependency injection and helper index setup.
"""
import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings

logger = logging.getLogger("guardian_shield")
settings = get_settings()

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGO_URI)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    global _db
    if _db is None:
        _db = get_client()[settings.MONGO_DB_NAME]
    return _db


async def init_indexes() -> None:
    """Create indexes used across collections. Safe to call repeatedly."""
    try:
        db = get_db()
        await db.users.create_index("email", unique=True)
        await db.contacts.create_index("user_id")
        await db.alerts.create_index("user_id")
        await db.alerts.create_index("created_at")
        await db.locations.create_index([("user_id", 1), ("timestamp", -1)])
    except Exception as exc:  # pragma: no cover - defensive deployment guard
        logger.warning("MongoDB startup indexes skipped: %s", exc)


async def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
