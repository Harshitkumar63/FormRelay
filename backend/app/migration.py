"""Schema migration service for form data.

This module provides a documented field-mapping mechanism for migrating
draft data between schema versions. It handles:
- Forward migration (v1 → v2)
- Compatible field preservation
- Preservation of removed/unknown fields in a _legacy bucket
- Validation of migrated data
- Detailed migration reports

Design decisions:
- Migrations are defined as explicit mapping functions, not generic transforms.
- Unknown fields from old versions are preserved in _legacy to avoid silent data loss.
- Each migration produces a report listing migrated, added, removed, and review-needed fields.
- Migrated data is validated against the target schema before being accepted.
"""

from app.schemas import (
    SCHEMA_VALIDATORS,
    MigrationFieldReport,
    SchemaMigrationResponse,
)


def _flatten_dict(d: dict, parent_key: str = "", sep: str = ".") -> dict:
    """Flatten a nested dict into dot-notation keys."""
    items: list[tuple[str, object]] = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(_flatten_dict(v, new_key, sep).items())
        else:
            items.append((new_key, v))
    return dict(items)


def _set_nested(d: dict, key: str, value: object, sep: str = ".") -> None:
    """Set a value in a nested dict using dot-notation key."""
    keys = key.split(sep)
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value


# ─── Migration: v1 → v2 ───────────────────────────────────────────────

# Fields that map directly from v1 to v2 (same path, same meaning)
V1_TO_V2_DIRECT_FIELDS = [
    "personal.first_name",
    "personal.last_name",
    "personal.date_of_birth",
    "personal.gender",
    "personal.nationality",
    "academic.institution",
    "academic.degree_program",
    "academic.gpa",
    "academic.enrollment_year",
    "academic.expected_graduation",
    "contact.email",
    "contact.phone",
    "contact.address_line1",
    "contact.address_line2",
    "contact.city",
    "contact.state",
    "contact.postal_code",
    "contact.country",
    "documents.transcript_available",
    "documents.recommendation_letters_count",
    "documents.personal_statement_words",
    "documents.additional_documents_description",
]

# New fields in v2 with their defaults
V2_NEW_FIELDS = {
    "academic.gpa_scale": "4.0",
    "academic.major": "",
    "academic.minor": "",
    "documents.portfolio_url": "",
    "documents.resume_available": False,
}


def migrate_v1_to_v2(data: dict) -> SchemaMigrationResponse:
    """Migrate form data from schema v1 to v2.

    Strategy:
    1. Copy all compatible fields directly.
    2. Add new v2 fields with defaults.
    3. Preserve any unknown fields in _legacy.
    4. Report all field changes.
    """
    flat_old = _flatten_dict(data)
    migrated: dict = {}
    reports: list[MigrationFieldReport] = []
    handled_keys: set[str] = set()

    # Step 1: Direct field migration
    for field_path in V1_TO_V2_DIRECT_FIELDS:
        if field_path in flat_old:
            _set_nested(migrated, field_path, flat_old[field_path])
            handled_keys.add(field_path)
            reports.append(MigrationFieldReport(
                field=field_path,
                status="migrated",
                old_value=str(flat_old[field_path]),
                new_value=str(flat_old[field_path]),
                message="Directly compatible field.",
            ))
        else:
            # Field exists in v2 but wasn't in the v1 data (might be empty)
            reports.append(MigrationFieldReport(
                field=field_path,
                status="migrated",
                old_value=None,
                new_value=None,
                message="Field not present in source data; will use default.",
            ))

    # Step 2: Add new v2 fields
    for field_path, default_value in V2_NEW_FIELDS.items():
        _set_nested(migrated, field_path, default_value)
        reports.append(MigrationFieldReport(
            field=field_path,
            status="added",
            old_value=None,
            new_value=str(default_value),
            message="New field in schema v2.",
        ))

    # Step 3: Preserve unhandled fields
    requires_review = False
    for key, value in flat_old.items():
        if key not in handled_keys:
            _set_nested(migrated, f"_legacy.{key}", value)
            reports.append(MigrationFieldReport(
                field=key,
                status="needs_review",
                old_value=str(value),
                new_value=None,
                message="Field not in v2 schema. Preserved in _legacy for review.",
            ))
            requires_review = True

    # Step 4: Validate migrated data
    try:
        validator = SCHEMA_VALIDATORS[2]
        # Validate the non-legacy parts
        filtered = {k: v for k, v in migrated.items() if k != "_legacy"}
        validator.model_validate(filtered)
    except Exception as e:
        requires_review = True
        reports.append(MigrationFieldReport(
            field="_validation",
            status="needs_review",
            message=f"Validation warning: {e}",
        ))

    return SchemaMigrationResponse(
        migrated_data=migrated,
        from_version=1,
        to_version=2,
        field_reports=reports,
        requires_review=requires_review,
        message="Migration complete. Review the field reports before accepting."
        if requires_review
        else "Migration complete. All fields migrated successfully.",
    )


def migrate_data(
    data: dict, from_version: int, to_version: int
) -> SchemaMigrationResponse:
    """Migrate form data between schema versions.

    Currently supports: v1 → v2.
    Raises ValueError for unsupported migration paths.
    """
    if from_version == to_version:
        return SchemaMigrationResponse(
            migrated_data=data,
            from_version=from_version,
            to_version=to_version,
            field_reports=[],
            requires_review=False,
            message="No migration needed; versions are identical.",
        )

    if from_version == 1 and to_version == 2:
        return migrate_v1_to_v2(data)

    raise ValueError(
        f"Unsupported migration path: v{from_version} → v{to_version}. "
        f"Only v1 → v2 is currently supported."
    )
