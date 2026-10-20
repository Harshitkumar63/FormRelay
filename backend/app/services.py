"""Business logic for draft operations.

This module contains the core logic for draft CRUD, sync, conflict detection,
and resolution. It is separated from the route handlers to keep the API layer
thin and the business logic testable.
"""

import hashlib
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.logging_config import get_logger
from app.migration import migrate_data
from app.models import AuditEvent, Draft, DraftRevision, Submission
from app.schemas import (
    SCHEMA_VALIDATORS,
    ConflictResolution,
    DraftCreate,
    DraftMigrateRequest,
    DraftResponse,
    DraftSyncRequest,
    DraftUpdate,
    MetricsResponse,
    RevisionResponse,
    SchemaMigrationResponse,
    SubmissionCreate,
    SubmissionResponse,
    SyncResult,
)

logger = get_logger()


def _compute_payload_hash(data: dict) -> str:
    """Compute a stable SHA-256 hash of the payload for idempotency checks."""
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _validate_form_data(data: dict, schema_version: int) -> list[str]:
    """Validate form data against the specified schema version.

    Returns a list of validation error messages. Empty list = valid.
    """
    validator_class = SCHEMA_VALIDATORS.get(schema_version)
    if not validator_class:
        return [f"Unknown schema version: {schema_version}"]

    errors: list[str] = []
    try:
        validator_class.model_validate(data)
    except Exception as e:
        errors.append(str(e))
    return errors


async def _record_audit(
    db: AsyncSession,
    event_type: str,
    entity_type: str,
    entity_id: str,
    correlation_id: str | None = None,
    detail: str | None = None,
) -> None:
    """Record an audit event. Does not commit - relies on caller's transaction."""
    event = AuditEvent(
        id=str(uuid.uuid4()),
        correlation_id=correlation_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail,
    )
    db.add(event)


async def _save_revision(
    db: AsyncSession,
    draft_id: str,
    revision: int,
    schema_version: int,
    data: dict,
    source: str = "client",
) -> None:
    """Save an immutable revision snapshot."""
    rev = DraftRevision(
        id=str(uuid.uuid4()),
        draft_id=draft_id,
        revision=revision,
        schema_version=schema_version,
        data=data,
        source=source,
    )
    db.add(rev)


# ─── Draft CRUD ────────────────────────────────────────────────────────


async def create_draft(
    db: AsyncSession,
    req: DraftCreate,
    owner_token: str,
    correlation_id: str | None = None,
) -> DraftResponse:
    """Create a new draft or idempotently register an offline draft."""
    draft_id = req.id or str(uuid.uuid4())

    # Check if a draft with this ID already exists
    existing_result = await db.execute(select(Draft).where(Draft.id == draft_id))
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        if existing.owner_token != owner_token:
            raise PermissionError(f"Draft {draft_id} already exists and belongs to another owner")
        logger.info("draft_idempotent_registration_hit", draft_id=draft_id)
        return DraftResponse(
            id=existing.id,
            form_id=existing.form_id,
            schema_version=existing.schema_version,
            revision=existing.revision,
            data=existing.data,
            status=existing.status,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
        )

    draft = Draft(
        id=draft_id,
        form_id=req.form_id,
        schema_version=req.schema_version,
        revision=1,
        data=req.data,
        status="draft",
        owner_token=owner_token,
    )
    db.add(draft)

    await _save_revision(db, draft.id, 1, req.schema_version, req.data, "client")
    await _record_audit(
        db, "draft.created", "draft", draft.id, correlation_id,
        detail=f"form_id={req.form_id}, schema_v={req.schema_version}",
    )
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        # Concurrently created with the same ID
        existing_result = await db.execute(select(Draft).where(Draft.id == draft_id))
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            if existing.owner_token != owner_token:
                raise PermissionError(f"Draft {draft_id} belongs to another owner")
            return DraftResponse(
                id=existing.id,
                form_id=existing.form_id,
                schema_version=existing.schema_version,
                revision=existing.revision,
                data=existing.data,
                status=existing.status,
                created_at=existing.created_at,
                updated_at=existing.updated_at,
            )
        raise

    logger.info("draft_created", draft_id=draft.id, form_id=req.form_id)
    return DraftResponse(
        id=draft.id,
        form_id=draft.form_id,
        schema_version=draft.schema_version,
        revision=draft.revision,
        data=draft.data,
        status=draft.status,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


async def get_draft(
    db: AsyncSession,
    draft_id: str,
    owner_token: str,
) -> Draft | None:
    """Fetch a draft by ID, enforcing ownership.

    Raises PermissionError if draft exists but belongs to another owner.
    Returns None if draft does not exist.
    """
    result = await db.execute(select(Draft).where(Draft.id == draft_id))
    draft = result.scalar_one_or_none()
    if draft is not None and draft.owner_token != owner_token:
        raise PermissionError(f"Draft {draft_id} belongs to another owner")
    return draft


async def update_draft(
    db: AsyncSession,
    draft_id: str,
    req: DraftUpdate,
    owner_token: str,
    correlation_id: str | None = None,
) -> DraftResponse | SyncResult:
    """Update a draft with atomic optimistic concurrency control.

    If expected_revision doesn't match server revision, returns a conflict result.
    """
    draft = await get_draft(db, draft_id, owner_token)
    if draft is None:
        raise LookupError(f"Draft {draft_id} not found")

    if draft.status == "submitted":
        raise ValueError("Cannot update a submitted draft")

    # Optimistic concurrency check against current server revision
    if req.expected_revision != draft.revision:
        logger.info(
            "revision_conflict",
            draft_id=draft_id,
            expected=req.expected_revision,
            actual=draft.revision,
        )
        return SyncResult(
            status="conflict",
            server_revision=draft.revision,
            server_data=draft.data,
            message=f"Revision conflict: expected {req.expected_revision}, server has {draft.revision}",
        )

    # Validate
    errors = _validate_form_data(req.data, req.schema_version)
    if errors:
        return SyncResult(
            status="validation_error",
            server_revision=draft.revision,
            message=f"Validation failed: {'; '.join(errors)}",
        )

    new_revision = req.expected_revision + 1
    now = datetime.now(timezone.utc)

    # Atomic conditional update
    stmt = (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.owner_token == owner_token,
            Draft.revision == req.expected_revision,
            Draft.status != "submitted",
        )
        .values(
            data=req.data,
            revision=new_revision,
            schema_version=req.schema_version,
            updated_at=now,
        )
    )
    result = await db.execute(stmt)
    if result.rowcount == 0:
        # Concurrent update won the race! Reload server state
        latest = await get_draft(db, draft_id, owner_token)
        if latest is None:
            raise LookupError(f"Draft {draft_id} not found")
        logger.info(
            "revision_conflict_race",
            draft_id=draft_id,
            expected=req.expected_revision,
            actual=latest.revision,
        )
        return SyncResult(
            status="conflict",
            server_revision=latest.revision,
            server_data=latest.data,
            message=f"Revision conflict: expected {req.expected_revision}, server has {latest.revision}",
        )

    await _save_revision(db, draft_id, new_revision, req.schema_version, req.data, "client")
    await _record_audit(
        db, "draft.updated", "draft", draft_id, correlation_id,
        detail=f"rev {req.expected_revision} → {new_revision}",
    )
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        latest = await get_draft(db, draft_id, owner_token)
        return SyncResult(
            status="conflict",
            server_revision=latest.revision if latest else new_revision,
            server_data=latest.data if latest else {},
            message="Revision conflict detected during concurrent update",
        )

    return DraftResponse(
        id=draft_id,
        form_id=draft.form_id,
        schema_version=req.schema_version,
        revision=new_revision,
        data=req.data,
        status="draft",
        created_at=draft.created_at,
        updated_at=now,
    )


# ─── Sync ──────────────────────────────────────────────────────────────


def _find_conflicting_fields(
    base_data: dict, local_data: dict, server_data: dict, prefix: str = ""
) -> list[str]:
    """Find fields where both local and server have diverged from the base.

    A field is conflicting only if:
    1. The local version changed it from the base, AND
    2. The server version also changed it from the base, AND
    3. The local and server values are different.

    If only one side changed, that side's value can be auto-merged.
    """
    conflicts: list[str] = []
    all_keys = set()
    for d in (base_data, local_data, server_data):
        if isinstance(d, dict):
            all_keys.update(d.keys())

    for key in all_keys:
        full_key = f"{prefix}.{key}" if prefix else key
        base_val = base_data.get(key) if isinstance(base_data, dict) else None
        local_val = local_data.get(key) if isinstance(local_data, dict) else None
        server_val = server_data.get(key) if isinstance(server_data, dict) else None

        if isinstance(base_val, dict) or isinstance(local_val, dict) or isinstance(server_val, dict):
            # Recurse into nested dicts
            conflicts.extend(_find_conflicting_fields(
                base_val if isinstance(base_val, dict) else {},
                local_val if isinstance(local_val, dict) else {},
                server_val if isinstance(server_val, dict) else {},
                full_key,
            ))
        else:
            local_changed = local_val != base_val
            server_changed = server_val != base_val
            if local_changed and server_changed and local_val != server_val:
                conflicts.append(full_key)

    return conflicts


async def sync_draft(
    db: AsyncSession,
    draft_id: str,
    req: DraftSyncRequest,
    owner_token: str,
    correlation_id: str | None = None,
) -> SyncResult:
    """Sync local changes with the server draft using optimistic concurrency.

    Algorithm:
    1. If base_revision matches server revision → apply local changes (fast-forward) via atomic update.
    2. If server has newer revision → check for actual field conflicts.
       - No conflicting fields → auto-merge via atomic update.
       - Conflicting fields → return conflict result for user resolution.
    """
    draft = await get_draft(db, draft_id, owner_token)
    if draft is None:
        raise LookupError(f"Draft {draft_id} not found")

    if draft.status == "submitted":
        raise ValueError("Cannot sync a submitted draft")

    # Validate incoming data
    errors = _validate_form_data(req.data, req.schema_version)
    if errors:
        return SyncResult(
            status="validation_error",
            server_revision=draft.revision,
            message=f"Validation failed: {'; '.join(errors)}",
        )

    now = datetime.now(timezone.utc)

    # Case 1: Fast-forward (no server changes since base)
    if req.base_revision == draft.revision:
        new_revision = draft.revision + 1
        stmt = (
            update(Draft)
            .where(
                Draft.id == draft_id,
                Draft.owner_token == owner_token,
                Draft.revision == req.base_revision,
                Draft.status != "submitted",
            )
            .values(
                data=req.data,
                revision=new_revision,
                schema_version=req.schema_version,
                updated_at=now,
            )
        )
        res = await db.execute(stmt)
        if res.rowcount > 0:
            await _save_revision(db, draft_id, new_revision, req.schema_version, req.data, "client")
            await _record_audit(
                db, "draft.synced", "draft", draft_id, correlation_id,
                detail=f"Fast-forward sync: rev {req.base_revision} → {new_revision}",
            )
            try:
                await db.flush()
                logger.info("sync_fast_forward", draft_id=draft_id, new_revision=new_revision)
                return SyncResult(
                    status="synced",
                    server_revision=new_revision,
                    server_data=req.data,
                    message="Synced successfully (fast-forward).",
                )
            except IntegrityError:
                await db.rollback()
                # Fall through to re-evaluating with latest server state

        # If fast-forward conditional update had rowcount == 0, server revision moved concurrently!
        draft = await get_draft(db, draft_id, owner_token)
        if draft is None:
            raise LookupError(f"Draft {draft_id} not found")

    # Case 2: Server has changed - need to check for conflicts
    # Fetch the base revision data
    base_result = await db.execute(
        select(DraftRevision).where(
            DraftRevision.draft_id == draft_id,
            DraftRevision.revision == req.base_revision,
        )
    )
    base_rev = base_result.scalar_one_or_none()
    base_data = base_rev.data if base_rev else {}

    conflicting_fields = _find_conflicting_fields(base_data, req.data, draft.data)

    if not conflicting_fields:
        # Auto-merge: take all local changes (since they don't conflict with server)
        merged = _auto_merge(base_data, req.data, draft.data)
        new_revision = draft.revision + 1

        stmt = (
            update(Draft)
            .where(
                Draft.id == draft_id,
                Draft.owner_token == owner_token,
                Draft.revision == draft.revision,
                Draft.status != "submitted",
            )
            .values(
                data=merged,
                revision=new_revision,
                schema_version=req.schema_version,
                updated_at=now,
            )
        )
        res = await db.execute(stmt)
        if res.rowcount > 0:
            await _save_revision(db, draft_id, new_revision, req.schema_version, merged, "merge")
            await _record_audit(
                db, "draft.auto_merged", "draft", draft_id, correlation_id,
                detail=f"Auto-merge: base={req.base_revision}, server={draft.revision - 1}",
            )
            try:
                await db.flush()
                logger.info("sync_auto_merged", draft_id=draft_id, new_revision=new_revision)
                return SyncResult(
                    status="synced",
                    server_revision=new_revision,
                    server_data=merged,
                    message="Synced with auto-merge (no conflicting fields).",
                )
            except IntegrityError:
                await db.rollback()
                draft = await get_draft(db, draft_id, owner_token)
                if draft is None:
                    raise LookupError(f"Draft {draft_id} not found")

    # Conflict detected - return details for user resolution
    await _record_audit(
        db, "draft.conflict_detected", "draft", draft_id, correlation_id,
        detail=f"Conflicts in: {', '.join(conflicting_fields)}",
    )
    await db.flush()

    logger.info("sync_conflict", draft_id=draft_id, conflicts=conflicting_fields)
    return SyncResult(
        status="conflict",
        server_revision=draft.revision,
        server_data=draft.data,
        conflicting_fields=conflicting_fields,
        base_data=base_data,
        message=f"Conflict detected in {len(conflicting_fields)} field(s). Please resolve.",
    )


def _auto_merge(base: dict, local: dict, server: dict) -> dict:
    """Three-way merge when there are no true conflicts.

    For each field:
    - If local changed from base and server didn't → use local value.
    - If server changed from base and local didn't → use server value.
    - If neither changed → use base value.
    """
    merged = {}
    all_keys = set()
    for d in (base, local, server):
        if isinstance(d, dict):
            all_keys.update(d.keys())

    for key in all_keys:
        base_val = base.get(key) if isinstance(base, dict) else None
        local_val = local.get(key) if isinstance(local, dict) else None
        server_val = server.get(key) if isinstance(server, dict) else None

        if isinstance(base_val, dict) or isinstance(local_val, dict) or isinstance(server_val, dict):
            merged[key] = _auto_merge(
                base_val if isinstance(base_val, dict) else {},
                local_val if isinstance(local_val, dict) else {},
                server_val if isinstance(server_val, dict) else {},
            )
        else:
            local_changed = local_val != base_val
            server_changed = server_val != base_val
            if local_changed:
                merged[key] = local_val
            elif server_changed:
                merged[key] = server_val
            else:
                merged[key] = base_val

    return merged


async def resolve_conflict(
    db: AsyncSession,
    draft_id: str,
    req: ConflictResolution,
    owner_token: str,
    correlation_id: str | None = None,
) -> DraftResponse:
    """Apply user's conflict resolution to a draft with atomic verification."""
    draft = await get_draft(db, draft_id, owner_token)
    if draft is None:
        raise LookupError(f"Draft {draft_id} not found")

    effective_server_rev = req.effective_server_revision
    if draft.revision != effective_server_rev:
        raise ValueError(
            f"Server has moved to revision {draft.revision} since conflict was detected. "
            f"Please re-sync."
        )

    # Validate resolved data
    errors = _validate_form_data(req.resolved_data, req.schema_version)
    if errors:
        raise ValueError(f"Resolved data failed validation: {'; '.join(errors)}")

    new_revision = effective_server_rev + 1
    now = datetime.now(timezone.utc)

    stmt = (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.owner_token == owner_token,
            Draft.revision == effective_server_rev,
            Draft.status != "submitted",
        )
        .values(
            data=req.resolved_data,
            revision=new_revision,
            schema_version=req.schema_version,
            updated_at=now,
        )
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        latest = await get_draft(db, draft_id, owner_token)
        if latest is None:
            raise LookupError(f"Draft {draft_id} not found")
        raise ValueError(
            f"Server has moved to revision {latest.revision} since conflict was detected. "
            f"Please re-sync."
        )

    await _save_revision(db, draft_id, new_revision, req.schema_version, req.resolved_data, "merge")
    await _record_audit(
        db, "draft.conflict_resolved", "draft", draft_id, correlation_id,
        detail=f"Conflict resolved at rev {new_revision}",
    )
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        latest = await get_draft(db, draft_id, owner_token)
        raise ValueError(
            f"Concurrent conflict resolution detected. Server is now at revision {latest.revision if latest else 'unknown'}."
        )

    logger.info("conflict_resolved", draft_id=draft_id, new_revision=new_revision)
    return DraftResponse(
        id=draft_id,
        form_id=draft.form_id,
        schema_version=req.schema_version,
        revision=new_revision,
        data=req.resolved_data,
        status="draft",
        created_at=draft.created_at,
        updated_at=now,
    )


async def migrate_draft(
    db: AsyncSession,
    draft_id: str,
    req: DraftMigrateRequest,
    owner_token: str,
    correlation_id: str | None = None,
) -> tuple[DraftResponse, SchemaMigrationResponse]:
    """Migrate a persisted draft in the database to a new schema version."""
    draft = await get_draft(db, draft_id, owner_token)
    if draft is None:
        raise LookupError(f"Draft {draft_id} not found")
    if draft.status == "submitted":
        raise ValueError("Cannot migrate a submitted draft")

    if draft.schema_version == req.to_version:
        report = SchemaMigrationResponse(
            from_version=draft.schema_version,
            to_version=req.to_version,
            migrated_data=draft.data,
            field_reports=[],
            message=f"Draft is already at schema version {req.to_version}.",
        )
        return DraftResponse(
            id=draft.id,
            form_id=draft.form_id,
            schema_version=draft.schema_version,
            revision=draft.revision,
            data=draft.data,
            status=draft.status,
            created_at=draft.created_at,
            updated_at=draft.updated_at,
        ), report

    migration_report = migrate_data(draft.data, draft.schema_version, req.to_version)
    new_rev = draft.revision + 1
    now = datetime.now(timezone.utc)

    stmt = (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.owner_token == owner_token,
            Draft.revision == draft.revision,
            Draft.status != "submitted",
        )
        .values(
            data=migration_report.migrated_data,
            revision=new_rev,
            schema_version=req.to_version,
            updated_at=now,
        )
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        raise ValueError("Draft was concurrently updated during schema migration. Please retry.")

    await _save_revision(db, draft_id, new_rev, req.to_version, migration_report.migrated_data, "migration")
    await _record_audit(
        db, "draft.migrated", "draft", draft_id, correlation_id,
        detail=f"Migrated v{draft.schema_version} → v{req.to_version} at rev {new_rev}",
    )
    await db.flush()

    logger.info("draft_migrated", draft_id=draft_id, from_version=draft.schema_version, to_version=req.to_version)
    return DraftResponse(
        id=draft_id,
        form_id=draft.form_id,
        schema_version=req.to_version,
        revision=new_rev,
        data=migration_report.migrated_data,
        status=draft.status,
        created_at=draft.created_at,
        updated_at=now,
    ), migration_report


async def get_revisions(
    db: AsyncSession,
    draft_id: str,
    owner_token: str,
) -> list[RevisionResponse]:
    """Get all revisions for a draft."""
    # Verify ownership first
    draft = await get_draft(db, draft_id, owner_token)
    if draft is None:
        raise LookupError(f"Draft {draft_id} not found or access denied")

    result = await db.execute(
        select(DraftRevision)
        .where(DraftRevision.draft_id == draft_id)
        .order_by(DraftRevision.revision)
    )
    revisions = result.scalars().all()
    return [
        RevisionResponse(
            id=r.id,
            draft_id=r.draft_id,
            revision=r.revision,
            schema_version=r.schema_version,
            data=r.data,
            source=r.source,
            created_at=r.created_at,
        )
        for r in revisions
    ]


# ─── Submission ────────────────────────────────────────────────────────


async def create_submission(
    db: AsyncSession,
    req: SubmissionCreate,
    owner_token: str,
    correlation_id: str | None = None,
) -> tuple[SubmissionResponse, bool]:
    """Create a final submission with idempotency enforcement.

    Returns (response, is_new):
    - is_new=True: New submission created.
    - is_new=False: Existing submission with same idempotency key returned.

    Raises:
    - PermissionError if idempotency key or draft belongs to another owner.
    - LookupError if draft is not found.
    - ValueError if same idempotency key is used with a different payload,
      or draft is already submitted, or form data fails validation.
    """
    payload_hash = _compute_payload_hash(req.data)

    # 1. Check for existing submission with this idempotency key
    existing_result = await db.execute(
        select(Submission).where(Submission.idempotency_key == req.idempotency_key)
    )
    existing = existing_result.scalar_one_or_none()

    if existing is not None:
        if existing.owner_token != owner_token:
            raise PermissionError(
                f"Idempotency key '{req.idempotency_key}' is already claimed by another owner"
            )
        if existing.payload_hash != payload_hash:
            raise ValueError(
                f"Idempotency key '{req.idempotency_key}' already used with a different payload. "
                f"Generate a new key for a different submission."
            )
        # Legitimate retry - return existing result
        logger.info("submission_idempotent_hit", submission_id=existing.id, key=req.idempotency_key)
        return SubmissionResponse(
            id=existing.id,
            draft_id=existing.draft_id,
            idempotency_key=existing.idempotency_key,
            schema_version=existing.schema_version,
            data=existing.data,
            status=existing.status,
            receipt_id=existing.receipt_id,
            created_at=existing.created_at,
        ), False

    # 2. Check draft existence & ownership
    draft_result = await db.execute(select(Draft).where(Draft.id == req.draft_id))
    draft = draft_result.scalar_one_or_none()
    if draft is None:
        raise LookupError(f"Draft {req.draft_id} not found")
    if draft.owner_token != owner_token:
        raise PermissionError(f"Draft {req.draft_id} belongs to another owner")
    if draft.status == "submitted":
        raise ValueError(f"Draft {req.draft_id} has already been submitted")

    # 3. Validate form data
    errors = _validate_form_data(req.data, req.schema_version)
    if errors:
        raise ValueError(f"Submission validation failed: {'; '.join(errors)}")

    # 4. Atomically mark draft as submitted
    upd_stmt = (
        update(Draft)
        .where(
            Draft.id == req.draft_id,
            Draft.owner_token == owner_token,
            Draft.status != "submitted",
        )
        .values(status="submitted", updated_at=datetime.now(timezone.utc))
    )
    upd_res = await db.execute(upd_stmt)
    if upd_res.rowcount == 0:
        # Check if another concurrent request with the same idempotency key already completed submission
        existing_result = await db.execute(
            select(Submission).where(Submission.idempotency_key == req.idempotency_key)
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            if existing.owner_token != owner_token:
                raise PermissionError(
                    f"Idempotency key '{req.idempotency_key}' is already claimed by another owner"
                )
            if existing.payload_hash != payload_hash:
                raise ValueError(
                    f"Idempotency key '{req.idempotency_key}' already used with a different payload."
                )
            logger.info("submission_idempotent_race_hit", submission_id=existing.id, key=req.idempotency_key)
            return SubmissionResponse(
                id=existing.id,
                draft_id=existing.draft_id,
                idempotency_key=existing.idempotency_key,
                schema_version=existing.schema_version,
                data=existing.data,
                status=existing.status,
                receipt_id=existing.receipt_id,
                created_at=existing.created_at,
            ), False
        raise ValueError(f"Draft {req.draft_id} has already been submitted")

    # 5. Insert submission
    submission = Submission(
        id=str(uuid.uuid4()),
        draft_id=req.draft_id,
        idempotency_key=req.idempotency_key,
        schema_version=req.schema_version,
        data=req.data,
        status="accepted",
        receipt_id=str(uuid.uuid4()),
        owner_token=owner_token,
        payload_hash=payload_hash,
    )
    db.add(submission)

    await _record_audit(
        db, "submission.created", "submission", submission.id, correlation_id,
        detail=f"draft_id={req.draft_id}, key={req.idempotency_key}",
    )
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        # Concurrently committed submission with the same idempotency key
        existing_result = await db.execute(
            select(Submission).where(Submission.idempotency_key == req.idempotency_key)
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            if existing.owner_token != owner_token:
                raise PermissionError(
                    f"Idempotency key '{req.idempotency_key}' is already claimed by another owner"
                )
            if existing.payload_hash != payload_hash:
                raise ValueError(
                    f"Idempotency key '{req.idempotency_key}' already used with a different payload. "
                    f"Generate a new key for a different submission."
                )
            logger.info("submission_idempotent_race_hit", submission_id=existing.id, key=req.idempotency_key)
            return SubmissionResponse(
                id=existing.id,
                draft_id=existing.draft_id,
                idempotency_key=existing.idempotency_key,
                schema_version=existing.schema_version,
                data=existing.data,
                status=existing.status,
                receipt_id=existing.receipt_id,
                created_at=existing.created_at,
            ), False
        raise

    logger.info("submission_created", submission_id=submission.id, draft_id=req.draft_id)
    return SubmissionResponse(
        id=submission.id,
        draft_id=submission.draft_id,
        idempotency_key=submission.idempotency_key,
        schema_version=submission.schema_version,
        data=submission.data,
        status=submission.status,
        receipt_id=submission.receipt_id,
        created_at=submission.created_at,
    ), True


async def get_submission(
    db: AsyncSession,
    submission_id: str,
    owner_token: str,
) -> Submission | None:
    """Fetch a submission by ID, enforcing ownership.

    Raises PermissionError if submission exists but belongs to another owner.
    Returns None if submission does not exist.
    """
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    sub = result.scalar_one_or_none()
    if sub is not None and sub.owner_token != owner_token:
        raise PermissionError(f"Submission {submission_id} belongs to another owner")
    return sub


async def get_submission_by_key(
    db: AsyncSession,
    idempotency_key: str,
    owner_token: str,
) -> Submission | None:
    """Fetch a submission by idempotency key, enforcing ownership.

    Raises PermissionError if idempotency key belongs to another owner.
    Returns None if submission does not exist.
    """
    result = await db.execute(
        select(Submission).where(Submission.idempotency_key == idempotency_key)
    )
    sub = result.scalar_one_or_none()
    if sub is not None and sub.owner_token != owner_token:
        raise PermissionError(f"Idempotency key '{idempotency_key}' belongs to another owner")
    return sub


# ─── Metrics ───────────────────────────────────────────────────────────


async def get_metrics(db: AsyncSession) -> MetricsResponse:
    """Get basic operational metrics."""
    drafts_count = (await db.execute(select(func.count(Draft.id)))).scalar() or 0
    submissions_count = (await db.execute(select(func.count(Submission.id)))).scalar() or 0

    conflicts_count = (await db.execute(
        select(func.count(AuditEvent.id)).where(
            AuditEvent.event_type == "draft.conflict_detected"
        )
    )).scalar() or 0

    syncs_count = (await db.execute(
        select(func.count(AuditEvent.id)).where(
            AuditEvent.event_type.in_(["draft.synced", "draft.auto_merged"])
        )
    )).scalar() or 0

    audit_count = (await db.execute(select(func.count(AuditEvent.id)))).scalar() or 0

    return MetricsResponse(
        total_drafts=drafts_count,
        total_submissions=submissions_count,
        total_conflicts=conflicts_count,
        total_syncs=syncs_count,
        total_audit_events=audit_count,
    )
