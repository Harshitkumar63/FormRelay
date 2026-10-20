"""Structured logging and middleware for request correlation."""

import uuid
from contextvars import ContextVar

import structlog

# Context variable for correlation ID - available throughout the request lifecycle
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")

SENSITIVE_KEYS = {"owner_token", "x_owner_token", "password", "token", "data", "payload", "resolved_data"}


def add_correlation_id(logger, method_name, event_dict):
    """Ensure correlation_id is present in structured log event."""
    cid = correlation_id_var.get()
    if cid and "correlation_id" not in event_dict:
        event_dict["correlation_id"] = cid
    return event_dict


def scrub_sensitive_keys(logger, method_name, event_dict):
    """Scrub sensitive credentials, tokens, or raw form payloads from logs."""
    for key in list(event_dict.keys()):
        if key.lower() in SENSITIVE_KEYS:
            event_dict[key] = "[REDACTED]"
    return event_dict


def configure_logging(debug: bool = False) -> None:
    """Configure structlog for structured JSON logging."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            add_correlation_id,
            scrub_sensitive_keys,
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
