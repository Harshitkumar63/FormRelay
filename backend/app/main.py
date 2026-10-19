"""FastAPI application entry point.

This module assembles the application with:
- CORS middleware
- Correlation ID middleware
- Health/readiness endpoints
- API routes
- Metrics endpoint
- Database lifecycle management
"""

import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import engine, get_db
from app.logging_config import configure_logging, correlation_id_var, get_logger
from app.models import Base
from app.routes import router as api_router
from app.schemas import HealthResponse, MetricsResponse, ReadyResponse
from app.services import get_metrics

configure_logging(debug=settings.debug)
logger = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: create tables on startup, cleanup on shutdown."""
    logger.info("starting_up", database_url=settings.database_url.split("@")[-1])  # Don't log credentials
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("database_ready")
    yield
    await engine.dispose()
    logger.info("shutdown_complete")


app = FastAPI(
    title="FormRelay API",
    description=(
        "Offline-First Form Recovery Infrastructure. "
        "Provides draft persistence, sync, conflict resolution, "
        "schema migration, and idempotent submission."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Correlation-Id"],
)


# Correlation ID middleware
@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    """Attach a correlation ID to every request for tracing."""
    cid = request.headers.get("X-Correlation-Id", str(uuid.uuid4()))
    correlation_id_var.set(cid)
    response: Response = await call_next(request)
    response.headers["X-Correlation-Id"] = cid
    return response


# ─── Health & Readiness ────────────────────────────────────────────────


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Infrastructure"],
    summary="Health check",
)
async def health():
    return HealthResponse(status="ok")


@app.get(
    "/ready",
    response_model=ReadyResponse,
    tags=["Infrastructure"],
    summary="Readiness check",
)
async def ready():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return ReadyResponse(status="ready", database="connected")
    except Exception as e:
        return ReadyResponse(
            status="not_ready",
            database="disconnected",
            message=str(e),
        )


# ─── Metrics ───────────────────────────────────────────────────────────


@app.get(
    "/api/metrics",
    response_model=MetricsResponse,
    tags=["Infrastructure"],
    summary="Operational metrics",
)
async def metrics_endpoint(db: AsyncSession = Depends(get_db)):
    return await get_metrics(db)


# ─── API Routes ────────────────────────────────────────────────────────

app.include_router(api_router, prefix=settings.api_prefix, tags=["API"])
