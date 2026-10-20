"""API route handlers.

This module contains all FastAPI route handlers. Each handler:
1. Extracts the owner token from the request header.
2. Delegates to the service layer for business logic.
3. Returns appropriate HTTP status codes and response schemas.

Authentication model (demo):
- A simple bearer token in the X-Owner-Token header.
- Each browser session generates a random token stored in localStorage.
- This is NOT production authentication; it's sufficient for the demo
  to prevent accidental cross-session access.
- In production, replace with OAuth2/JWT.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.logging_config import correlation_id_var, get_logger
from app.migration import migrate_data
from app.schemas import (
    ConflictResolution,
    DraftCreate,
    DraftMigrateRequest,
    DraftResponse,
    DraftSyncRequest,
    DraftUpdate,
    ErrorResponse,
    RevisionResponse,
    SchemaMigrationRequest,
    SchemaMigrationResponse,
    SubmissionCreate,
    SubmissionResponse,
    SyncResult,
)
from app.services import (
    create_draft,
    create_submission,
    get_draft,
    get_revisions,
    get_submission,
    get_submission_by_key,
    migrate_draft,
    resolve_conflict,
    sync_draft,
    update_draft,
)

logger = get_logger()

router = APIRouter()


def _get_owner_token(x_owner_token: str = Header(..., min_length=8, max_length=64)) -> str:
    """Extract and validate the owner token from request headers.

    SECURITY NOTE:
    X-Owner-Token is a demo authentication mechanism for session isolation.
    Limitations:
    - No cryptographic signature or asymmetric verification.
    - No token expiration, revocation, or refresh flow.
    - No binding to user identity in an external IdP.
    Production systems must use OAuth 2.0 / OIDC JWTs with verified claims.
    """
    return x_owner_token


# ─── Drafts ────────────────────────────────────────────────────────────


@router.post(
    "/drafts",
    response_model=DraftResponse,
    status_code=201,
    responses={400: {"model": ErrorResponse}, 403: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    summary="Create a new draft",
    description="Create a new form draft or idempotently register an offline-created draft.",
)
async def create_draft_endpoint(
    req: DraftCreate,
    request: Request,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    correlation_id = correlation_id_var.get()
    try:
        return await create_draft(db, req, owner_token, correlation_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("create_draft_error", error=str(e))
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/drafts/{draft_id}",
    response_model=DraftResponse,
    responses={404: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
    summary="Get a draft by ID",
    description="Retrieve a draft. Only the owner can access their drafts.",
)
async def get_draft_endpoint(
    draft_id: str,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    try:
        draft = await get_draft(db, draft_id, owner_token)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
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


@router.put(
    "/drafts/{draft_id}",
    response_model=DraftResponse | SyncResult,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": SyncResult},
        422: {"model": ErrorResponse},
    },
    summary="Update a draft",
    description="Update a draft with optimistic concurrency control. Returns 409 on revision conflict.",
)
async def update_draft_endpoint(
    draft_id: str,
    req: DraftUpdate,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    correlation_id = correlation_id_var.get()
    try:
        result = await update_draft(db, draft_id, req, owner_token, correlation_id)
        if isinstance(result, SyncResult) and result.status == "conflict":
            raise HTTPException(status_code=409, detail=result.model_dump())
        if isinstance(result, SyncResult) and result.status == "validation_error":
            raise HTTPException(status_code=422, detail=result.model_dump())
        return result
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Draft not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/drafts/{draft_id}/revisions",
    response_model=list[RevisionResponse],
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    summary="Get draft revision history",
    description="Retrieve all revisions for a draft, ordered by revision number.",
)
async def get_revisions_endpoint(
    draft_id: str,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_revisions(db, draft_id, owner_token)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Draft not found")


# ─── Sync ──────────────────────────────────────────────────────────────


@router.post(
    "/drafts/{draft_id}/sync",
    response_model=SyncResult,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": SyncResult},
        422: {"model": SyncResult},
    },
    summary="Sync local changes with server",
    description=(
        "Three-way sync: compares base, local, and server revisions. "
        "Fast-forwards if no server changes, auto-merges if no conflicts, "
        "or returns conflict details for user resolution."
    ),
)
async def sync_draft_endpoint(
    draft_id: str,
    req: DraftSyncRequest,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    correlation_id = correlation_id_var.get()
    try:
        result = await sync_draft(db, draft_id, req, owner_token, correlation_id)
        if result.status == "conflict":
            raise HTTPException(status_code=409, detail=result.model_dump())
        if result.status == "validation_error":
            raise HTTPException(status_code=422, detail=result.model_dump())
        return result
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Draft not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/drafts/{draft_id}/resolve-conflict",
    response_model=DraftResponse,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
    summary="Resolve a conflict",
    description="Apply user's conflict resolution. The resolved data replaces the server draft.",
)
async def resolve_conflict_endpoint(
    draft_id: str,
    req: ConflictResolution,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    correlation_id = correlation_id_var.get()
    try:
        return await resolve_conflict(db, draft_id, req, owner_token, correlation_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Draft not found")
    except ValueError as e:
        raise HTTPException(
            status_code=409 if "revision" in str(e).lower() else 422,
            detail=str(e),
        )


@router.post(
    "/drafts/{draft_id}/migrate",
    response_model=DraftResponse,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
    summary="Migrate persisted draft to target schema version",
    description="Migrate a persisted draft in the database to a target schema version with a new revision snapshot.",
)
async def migrate_draft_endpoint(
    draft_id: str,
    req: DraftMigrateRequest,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    correlation_id = correlation_id_var.get()
    try:
        draft, _ = await migrate_draft(db, draft_id, req, owner_token, correlation_id)
        return draft
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Draft not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# ─── Schema Migration ─────────────────────────────────────────────────


@router.post(
    "/schema/migrate",
    response_model=SchemaMigrationResponse,
    summary="Migrate form data between schema versions",
    description="Migrate draft data from one schema version to another in-memory. Returns a migration report.",
)
async def migrate_schema_endpoint(req: SchemaMigrationRequest):
    try:
        return migrate_data(req.data, req.from_version, req.to_version)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Submissions ───────────────────────────────────────────────────────


@router.post(
    "/submissions",
    response_model=SubmissionResponse,
    status_code=201,
    responses={
        200: {"model": SubmissionResponse, "description": "Existing submission returned (idempotent)"},
        403: {"model": ErrorResponse, "description": "Draft or idempotency key belongs to another owner"},
        404: {"model": ErrorResponse, "description": "Draft not found"},
        409: {"model": ErrorResponse, "description": "Same key, different payload"},
        422: {"model": ErrorResponse},
    },
    summary="Submit an application",
    description=(
        "Submit a completed application. Uses idempotency key to prevent duplicates. "
        "Retrying with the same key and payload returns the existing result. "
        "Same key with a different payload is rejected."
    ),
)
async def create_submission_endpoint(
    req: SubmissionCreate,
    response: Response,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    correlation_id = correlation_id_var.get()
    try:
        submission, is_new = await create_submission(db, req, owner_token, correlation_id)
        if not is_new:
            response.status_code = 200  # Override 201 for idempotent hit
        return submission
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        error_msg = str(e)
        if "idempotency" in error_msg.lower() or "different payload" in error_msg.lower():
            raise HTTPException(status_code=409, detail=error_msg)
        raise HTTPException(status_code=422, detail=error_msg)


@router.get(
    "/submissions/{submission_id}",
    response_model=SubmissionResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    summary="Get a submission by ID",
)
async def get_submission_endpoint(
    submission_id: str,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    try:
        sub = await get_submission(db, submission_id, owner_token)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return SubmissionResponse(
        id=sub.id,
        draft_id=sub.draft_id,
        idempotency_key=sub.idempotency_key,
        schema_version=sub.schema_version,
        data=sub.data,
        status=sub.status,
        receipt_id=sub.receipt_id,
        created_at=sub.created_at,
    )


@router.get(
    "/submissions/by-idempotency-key/{key}",
    response_model=SubmissionResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    summary="Get a submission by idempotency key",
    description="Check submission status by idempotency key. Useful for reconciling uncertain outcomes.",
)
async def get_submission_by_key_endpoint(
    key: str,
    owner_token: str = Depends(_get_owner_token),
    db: AsyncSession = Depends(get_db),
):
    try:
        sub = await get_submission_by_key(db, key, owner_token)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found for this key")
    return SubmissionResponse(
        id=sub.id,
        draft_id=sub.draft_id,
        idempotency_key=sub.idempotency_key,
        schema_version=sub.schema_version,
        data=sub.data,
        status=sub.status,
        receipt_id=sub.receipt_id,
        created_at=sub.created_at,
    )
