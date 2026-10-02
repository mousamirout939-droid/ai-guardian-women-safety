import asyncio
import logging
from contextlib import asynccontextmanager

import redis
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import get_settings
from app.core.sos import sos_escalation_worker
from app.database import close_client, get_db, init_indexes
from app.routes import ai_inference, alerts, auth, contacts, safety, websocket

logger = logging.getLogger("guardian_shield")
settings = get_settings()


def _build_limiter() -> Limiter:
    """
    Uses Redis-backed rate limiting (shared across server instances) when
    Redis is reachable, so limits hold under horizontal scaling. Falls back
    to in-memory storage (single-instance only) if Redis isn't available —
    this keeps `uvicorn app.main:app` runnable for local development without
    requiring the full docker-compose stack, per the README's local quick start.
    """
    try:
        client = redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        client.ping()
        logger.info("Rate limiting: connected to Redis at %s", settings.REDIS_URL)
        return Limiter(key_func=get_remote_address, storage_uri=settings.REDIS_URL, default_limits=["120/minute"])
    except redis.exceptions.RedisError:
        logger.warning(
            "Rate limiting: Redis unreachable at %s — falling back to in-memory storage "
            "(fine for local dev / a single instance; not shared across replicas).",
            settings.REDIS_URL,
        )
        return Limiter(key_func=get_remote_address, default_limits=["120/minute"])


limiter = _build_limiter()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_indexes()
    escalation_task = asyncio.create_task(sos_escalation_worker(get_db))
    try:
        yield
    finally:
        escalation_task.cancel()
        try:
            await escalation_task
        except asyncio.CancelledError:
            pass
        await close_client()


app = FastAPI(
    title=settings.APP_NAME,
    description="AI-Powered Women's Safety Network — API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(alerts.router)
app.include_router(ai_inference.router)
app.include_router(safety.router)
app.include_router(websocket.router)


@app.get("/api/health", tags=["system"])
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.ENV}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    detail = str(exc) if settings.DEBUG else "Internal server error"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": detail},
    )