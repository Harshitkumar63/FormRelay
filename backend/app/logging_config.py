"""Structured logging and middleware for request correlation."""

import uuid
from contextvars import ContextVar

import structlog

# Context variable for correlation ID - available throughout the request lifecycle
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")


def configure_logging(debug: bool = False) -> None:
    """Configure structlog for structured JSON logging."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.dev.ConsoleRenderer() if debug else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            structlog.stdlib.NAME_TO_LEVEL["debug" if debug else "info"]
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger() -> structlog.stdlib.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger()


def generate_correlation_id() -> str:
    """Generate a unique correlation ID for request tracing."""
    return str(uuid.uuid4())
