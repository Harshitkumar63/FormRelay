"""SQLAlchemy models for FormRelay.

Data model overview:
- Draft: Represents a form draft with current data, revision tracking, and schema version.
- DraftRevision: Immutable snapshot of a draft at a given revision for audit/conflict resolution.
- Submission: Final submitted application with idempotency enforcement.
- AuditEvent: Lightweight audit log for operational events.

Concurrency control:
- Optimistic concurrency via `revision` column on Draft.
- All updates must include the expected revision; mismatches return 409 Conflict.
- This prevents silent overwrites from concurrent edits.

Limitations:
- No multi-user real-time collaboration. One logical user per draft.
- Revision conflicts are detected but not auto-merged; user must resolve.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class Draft(Base):
    """A form draft with optimistic concurrency control.

    The `revision` column is incremented on every update.
    Clients must send the expected revision when updating;
    if it doesn't match, the update is rejected (409 Conflict).
    """

    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    form_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft"
    )  # draft | submitted
    owner_token: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True
    )  # Simple bearer token for demo auth
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_drafts_owner_form", "owner_token", "form_id"),
    )


class DraftRevision(Base):
    """Immutable snapshot of a draft at a specific revision.

    Used for:
    - Conflict detection (comparing base revision with server state)
    - Audit trail of changes
    - Recovery if a sync goes wrong
    """

    __tablename__ = "draft_revisions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    draft_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="client"
    )  # client | server | merge
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("draft_id", "revision", name="uq_draft_revision"),
        Index("ix_draft_revisions_draft_rev", "draft_id", "revision"),
    )


class Submission(Base):
    """Final submitted application.

    Idempotency is enforced via the `idempotency_key` unique constraint.
    If a submission with the same key already exists:
    - Same payload → return existing result (200)
    - Different payload → reject (409)

    This provides effectively-once processing for the submission workflow,
    though it does not guarantee exactly-once network delivery.
    """

    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    draft_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="accepted"
    )  # accepted | rejected | processing
    receipt_id: Mapped[str] = mapped_column(
        String(36), nullable=False, default=lambda: str(uuid.uuid4())
    )
    owner_token: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload_hash: Mapped[str] = mapped_column(
        String(64), nullable=False
    )  # SHA-256 of canonical payload for duplicate detection
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_submissions_idempotency", "idempotency_key"),
    )


class AuditEvent(Base):
    """Lightweight audit log for operational events.

    Records significant actions like draft creation, sync, conflict resolution,
    and submission. Does NOT store full form data to avoid logging PII.
    """

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    correlation_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # draft.created, draft.synced, submission.created, etc.
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # draft | submission
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
