"""Pydantic schemas for API request/response validation.

These schemas enforce input validation, provide clear error messages,
and define the contract between frontend and backend.
"""

from datetime import datetime

from pydantic import BaseModel, Field


# ─── Scholarship Form Schema Definitions ───────────────────────────────

class PersonalInfo(BaseModel):
    """Schema v1+v2: Personal information fields."""
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    date_of_birth: str = Field(default="", max_length=10)  # YYYY-MM-DD
    gender: str = Field(default="", max_length=20)
    nationality: str = Field(default="", max_length=100)


class AcademicInfo(BaseModel):
    """Schema v1: Academic details."""
    institution: str = Field(default="", max_length=200)
    degree_program: str = Field(default="", max_length=200)
    gpa: str = Field(default="", max_length=10)
    enrollment_year: str = Field(default="", max_length=4)
    expected_graduation: str = Field(default="", max_length=10)


class AcademicInfoV2(BaseModel):
    """Schema v2: Academic details with additional fields."""
    institution: str = Field(default="", max_length=200)
    degree_program: str = Field(default="", max_length=200)
    gpa: str = Field(default="", max_length=10)
    gpa_scale: str = Field(default="4.0", max_length=10)  # New in v2
    enrollment_year: str = Field(default="", max_length=4)
    expected_graduation: str = Field(default="", max_length=10)
    major: str = Field(default="", max_length=200)  # New in v2
    minor: str = Field(default="", max_length=200)  # New in v2


class ContactInfo(BaseModel):
    """Schema v1+v2: Contact information."""
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=20)
    address_line1: str = Field(default="", max_length=200)
    address_line2: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=100)
    postal_code: str = Field(default="", max_length=20)
    country: str = Field(default="", max_length=100)


class DocumentMeta(BaseModel):
    """Schema v1: Supporting document metadata (no actual upload in v1)."""
    transcript_available: bool = False
    recommendation_letters_count: int = Field(default=0, ge=0, le=5)
    personal_statement_words: int = Field(default=0, ge=0)
    additional_documents_description: str = Field(default="", max_length=500)


class DocumentMetaV2(BaseModel):
    """Schema v2: Extended document metadata."""
    transcript_available: bool = False
    recommendation_letters_count: int = Field(default=0, ge=0, le=5)
    personal_statement_words: int = Field(default=0, ge=0)
    additional_documents_description: str = Field(default="", max_length=500)
    portfolio_url: str = Field(default="", max_length=500)  # New in v2
    resume_available: bool = False  # New in v2


class ScholarshipFormV1(BaseModel):
    """Complete scholarship form schema version 1."""
    personal: PersonalInfo = Field(default_factory=PersonalInfo)
    academic: AcademicInfo = Field(default_factory=AcademicInfo)
    contact: ContactInfo = Field(default_factory=ContactInfo)
    documents: DocumentMeta = Field(default_factory=DocumentMeta)


class ScholarshipFormV2(BaseModel):
    """Complete scholarship form schema version 2 with extended fields."""
    personal: PersonalInfo = Field(default_factory=PersonalInfo)
    academic: AcademicInfoV2 = Field(default_factory=AcademicInfoV2)
    contact: ContactInfo = Field(default_factory=ContactInfo)
    documents: DocumentMetaV2 = Field(default_factory=DocumentMetaV2)


# Map of schema versions to their validator classes
SCHEMA_VALIDATORS: dict[int, type[BaseModel]] = {
    1: ScholarshipFormV1,
    2: ScholarshipFormV2,
}

CURRENT_SCHEMA_VERSION = 2


# ─── API Request/Response Schemas ──────────────────────────────────────

class ErrorResponse(BaseModel):
    """Standard error response."""
    error: str
    detail: str | None = None
    correlation_id: str | None = None


class DraftCreate(BaseModel):
    """Request to create a new draft."""
    form_id: str = Field(max_length=100)
    schema_version: int = Field(default=CURRENT_SCHEMA_VERSION, ge=1, le=2)
    data: dict = Field(default_factory=dict)


class DraftUpdate(BaseModel):
    """Request to update a draft. Requires expected revision for OCC."""
    data: dict
    expected_revision: int = Field(ge=1, description="Client's expected server revision for OCC")
    schema_version: int = Field(ge=1, le=2)


class DraftResponse(BaseModel):
    """Draft data returned to client."""
    id: str
    form_id: str
    schema_version: int
    revision: int
    data: dict
    status: str
    created_at: datetime
    updated_at: datetime


class DraftSyncRequest(BaseModel):
    """Request to sync local changes with server."""
    data: dict
    local_revision: int = Field(ge=1)
    base_revision: int = Field(ge=1, description="Revision the client last synced from")
    schema_version: int = Field(ge=1, le=2)


class SyncResult(BaseModel):
    """Result of a sync operation."""
    status: str  # synced | conflict | validation_error
    server_revision: int
    server_data: dict | None = None
    conflicting_fields: list[str] | None = None
    base_data: dict | None = None
    message: str = ""


class ConflictResolution(BaseModel):
    """Client's resolution of a conflict."""
    resolved_data: dict
    base_revision: int = Field(ge=1)
    server_revision: int = Field(ge=1)
    schema_version: int = Field(ge=1, le=2)


class RevisionResponse(BaseModel):
    """A single revision entry."""
    id: str
    draft_id: str
    revision: int
    schema_version: int
    data: dict
    source: str
    created_at: datetime


class SubmissionCreate(BaseModel):
    """Request to submit a completed application."""
    draft_id: str
    idempotency_key: str = Field(max_length=64, min_length=8)
    data: dict
    schema_version: int = Field(ge=1, le=2)


class SubmissionResponse(BaseModel):
    """Submitted application data."""
    id: str
    draft_id: str
    idempotency_key: str
    schema_version: int
    data: dict
    status: str
    receipt_id: str
    created_at: datetime


class SchemaMigrationRequest(BaseModel):
    """Request to migrate draft data from one schema version to another."""
    data: dict
    from_version: int = Field(ge=1)
    to_version: int = Field(ge=1, le=2)


class MigrationFieldReport(BaseModel):
    """Report on a single field during migration."""
    field: str
    status: str  # migrated | removed | needs_review | added
    old_value: str | None = None
    new_value: str | None = None
    message: str = ""


class SchemaMigrationResponse(BaseModel):
    """Result of a schema migration."""
    migrated_data: dict
    from_version: int
    to_version: int
    field_reports: list[MigrationFieldReport]
    requires_review: bool
    message: str


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str = "0.1.0"


class ReadyResponse(BaseModel):
    """Readiness check response."""
    status: str
    database: str
    message: str = ""


class MetricsResponse(BaseModel):
    """Basic operational metrics."""
    total_drafts: int
    total_submissions: int
    total_conflicts: int
    total_syncs: int
    total_audit_events: int
