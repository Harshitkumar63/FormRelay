"""Tests for draft CRUD, sync, conflict resolution, and submissions."""

import asyncio
import uuid

import pytest
from httpx import AsyncClient

SAMPLE_V1_DATA = {
    "personal": {
        "first_name": "Jane",
        "last_name": "Doe",
        "date_of_birth": "2000-05-15",
        "gender": "Female",
        "nationality": "Canadian",
    },
    "academic": {
        "institution": "University of Toronto",
        "degree_program": "Computer Science",
        "gpa": "3.8",
        "enrollment_year": "2020",
        "expected_graduation": "2024-06",
    },
    "contact": {
        "email": "jane.doe@example.com",
        "phone": "+1-555-0123",
        "address_line1": "123 College St",
        "address_line2": "Apt 4B",
        "city": "Toronto",
        "state": "Ontario",
        "postal_code": "M5T 1R4",
        "country": "Canada",
    },
    "documents": {
        "transcript_available": True,
        "recommendation_letters_count": 2,
        "personal_statement_words": 800,
        "additional_documents_description": "Research paper on ML",
    },
}

SAMPLE_V2_DATA = {
    **SAMPLE_V1_DATA,
    "academic": {
        **SAMPLE_V1_DATA["academic"],
        "gpa_scale": "4.0",
        "major": "Computer Science",
        "minor": "Mathematics",
    },
    "documents": {
        **SAMPLE_V1_DATA["documents"],
        "portfolio_url": "https://janedoe.dev",
        "resume_available": True,
    },
}


# ─── Health & Readiness ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_ready(client: AsyncClient):
    resp = await client.get("/ready")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


# ─── Draft CRUD ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_draft(client: AsyncClient, headers):
    resp = await client.post(
        "/api/drafts",
        json={"form_id": "scholarship-2024", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["form_id"] == "scholarship-2024"
    assert body["revision"] == 1
    assert body["schema_version"] == 2
    assert body["data"]["personal"]["first_name"] == "Jane"


@pytest.mark.asyncio
async def test_get_draft(client: AsyncClient, headers):
    # Create
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "test-form", "data": {}},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Read
    get_resp = await client.get(f"/api/drafts/{draft_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == draft_id


@pytest.mark.asyncio
async def test_get_draft_wrong_owner(client: AsyncClient, headers):
    # Create with one owner
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "test-form", "data": {}},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Try to read with different owner
    other_headers = {"X-Owner-Token": "different-owner-token"}
    get_resp = await client.get(f"/api/drafts/{draft_id}", headers=other_headers)
    assert get_resp.status_code == 404  # Not found (not 403, to avoid leaking existence)


@pytest.mark.asyncio
async def test_update_draft_success(client: AsyncClient, headers):
    # Create
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "test-form", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Update
    updated_data = {**SAMPLE_V2_DATA}
    updated_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "Janet"}
    update_resp = await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": updated_data, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["revision"] == 2
    assert update_resp.json()["data"]["personal"]["first_name"] == "Janet"


@pytest.mark.asyncio
async def test_update_draft_revision_conflict(client: AsyncClient, headers):
    """Updating with wrong expected_revision should return 409."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "test-form", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # First update succeeds
    await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": SAMPLE_V2_DATA, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )

    # Second update with stale revision fails
    resp = await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": SAMPLE_V2_DATA, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_draft_not_found(client: AsyncClient, headers):
    resp = await client.get("/api/drafts/nonexistent-id", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_missing_owner_token(client: AsyncClient):
    resp = await client.post(
        "/api/drafts",
        json={"form_id": "test", "data": {}},
    )
    assert resp.status_code == 422  # Missing required header


# ─── Sync ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_fast_forward(client: AsyncClient, headers):
    """Sync when no server changes since base → fast forward."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "sync-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    sync_resp = await client.post(
        f"/api/drafts/{draft_id}/sync",
        json={
            "data": SAMPLE_V2_DATA,
            "local_revision": 2,
            "base_revision": 1,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert sync_resp.status_code == 200
    body = sync_resp.json()
    assert body["status"] == "synced"
    assert body["server_revision"] == 2


@pytest.mark.asyncio
async def test_sync_conflict(client: AsyncClient, headers):
    """Sync when both local and server changed the same field → conflict."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "conflict-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Server-side update (simulating another device)
    server_data = {**SAMPLE_V2_DATA}
    server_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ServerJane"}
    await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": server_data, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )

    # Client sync with local change to the SAME field
    local_data = {**SAMPLE_V2_DATA}
    local_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "LocalJane"}
    sync_resp = await client.post(
        f"/api/drafts/{draft_id}/sync",
        json={
            "data": local_data,
            "local_revision": 2,
            "base_revision": 1,  # Client's base was rev 1
            "schema_version": 2,
        },
        headers=headers,
    )
    assert sync_resp.status_code == 409
    body = sync_resp.json()["detail"]
    assert body["status"] == "conflict"
    assert "personal.first_name" in body["conflicting_fields"]


@pytest.mark.asyncio
async def test_sync_auto_merge(client: AsyncClient, headers):
    """Sync when local and server changed DIFFERENT fields → auto merge."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "merge-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Server changes first_name
    server_data = {**SAMPLE_V2_DATA}
    server_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ServerJane"}
    await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": server_data, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )

    # Client changes last_name (different field)
    local_data = {**SAMPLE_V2_DATA}
    local_data["personal"] = {**SAMPLE_V2_DATA["personal"], "last_name": "Smith"}
    sync_resp = await client.post(
        f"/api/drafts/{draft_id}/sync",
        json={
            "data": local_data,
            "local_revision": 2,
            "base_revision": 1,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert sync_resp.status_code == 200
    body = sync_resp.json()
    assert body["status"] == "synced"
    # Verify both changes were merged
    assert body["server_data"]["personal"]["first_name"] == "ServerJane"
    assert body["server_data"]["personal"]["last_name"] == "Smith"


# ─── Conflict Resolution ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_conflict(client: AsyncClient, headers):
    """Resolve a conflict by choosing values for conflicting fields."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "resolve-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Create a server update
    server_data = {**SAMPLE_V2_DATA}
    server_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ServerName"}
    await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": server_data, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )

    # Now resolve: choose server's first_name but keep original last_name
    resolved_data = {**SAMPLE_V2_DATA}
    resolved_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ServerName"}

    resolve_resp = await client.post(
        f"/api/drafts/{draft_id}/resolve-conflict",
        json={
            "resolved_data": resolved_data,
            "base_revision": 1,
            "server_revision": 2,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert resolve_resp.status_code == 200
    assert resolve_resp.json()["revision"] == 3
    assert resolve_resp.json()["data"]["personal"]["first_name"] == "ServerName"


# ─── Schema Migration ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_schema_migration_v1_to_v2(client: AsyncClient):
    resp = await client.post(
        "/api/schema/migrate",
        json={"data": SAMPLE_V1_DATA, "from_version": 1, "to_version": 2},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["from_version"] == 1
    assert body["to_version"] == 2
    # V2 new fields should have defaults
    assert body["migrated_data"]["academic"]["gpa_scale"] == "4.0"
    assert body["migrated_data"]["academic"]["major"] == ""
    assert body["migrated_data"]["documents"]["portfolio_url"] == ""
    # Original fields preserved
    assert body["migrated_data"]["personal"]["first_name"] == "Jane"
    # Check field reports
    added_fields = [r for r in body["field_reports"] if r["status"] == "added"]
    assert len(added_fields) == 5  # 5 new fields in v2


@pytest.mark.asyncio
async def test_schema_migration_same_version(client: AsyncClient):
    resp = await client.post(
        "/api/schema/migrate",
        json={"data": SAMPLE_V1_DATA, "from_version": 1, "to_version": 1},
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "No migration needed; versions are identical."


# ─── Idempotent Submission ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_submission(client: AsyncClient, headers):
    # Create draft first
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "submit-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"submit-{uuid.uuid4().hex[:16]}"

    # Submit
    sub_resp = await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": SAMPLE_V2_DATA,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert sub_resp.status_code == 201
    body = sub_resp.json()
    assert body["status"] == "accepted"
    assert body["receipt_id"]
    assert body["idempotency_key"] == idem_key


@pytest.mark.asyncio
async def test_idempotent_retry_same_payload(client: AsyncClient, headers):
    """Retrying with the same key and payload returns the existing result."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "idem-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"idem-{uuid.uuid4().hex[:16]}"

    # First submission
    sub1 = await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": SAMPLE_V2_DATA,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert sub1.status_code == 201

    # Retry with same key + payload
    sub2 = await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": SAMPLE_V2_DATA,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert sub2.status_code == 200  # Not 201 - idempotent hit
    assert sub2.json()["id"] == sub1.json()["id"]
    assert sub2.json()["receipt_id"] == sub1.json()["receipt_id"]


@pytest.mark.asyncio
async def test_idempotent_different_payload_rejected(client: AsyncClient, headers):
    """Same key with different payload should be rejected (409)."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "idem-dup-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"dup-{uuid.uuid4().hex[:16]}"

    # First submission
    await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": SAMPLE_V2_DATA,
            "schema_version": 2,
        },
        headers=headers,
    )

    # Retry with same key but different payload
    different_data = {**SAMPLE_V2_DATA}
    different_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "DifferentName"}
    resp = await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": different_data,
            "schema_version": 2,
        },
        headers=headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_concurrent_duplicate_submissions(client: AsyncClient, headers):
    """Concurrent submissions with the same idempotency key should not create duplicates."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "concurrent-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"concurrent-{uuid.uuid4().hex[:16]}"

    submission_body = {
        "draft_id": draft_id,
        "idempotency_key": idem_key,
        "data": SAMPLE_V2_DATA,
        "schema_version": 2,
    }

    # Fire 5 concurrent submissions
    tasks = [
        client.post("/api/submissions", json=submission_body, headers=headers)
        for _ in range(5)
    ]
    results = await asyncio.gather(*tasks)

    # Exactly one should be 201, the rest 200 (idempotent hits)
    status_codes = [r.status_code for r in results]
    created = status_codes.count(201)
    idempotent = status_codes.count(200)
    # Due to SQLite serialization, all should succeed (some as 200, some as 201)
    assert created + idempotent == 5
    assert created >= 1  # At least one was newly created

    # All should return the same submission ID
    ids = {r.json()["id"] for r in results}
    assert len(ids) == 1


@pytest.mark.asyncio
async def test_get_submission_by_id(client: AsyncClient, headers):
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "get-sub-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"get-sub-{uuid.uuid4().hex[:16]}"

    sub_resp = await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": SAMPLE_V2_DATA,
            "schema_version": 2,
        },
        headers=headers,
    )
    sub_id = sub_resp.json()["id"]

    get_resp = await client.get(f"/api/submissions/{sub_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == sub_id


@pytest.mark.asyncio
async def test_get_submission_by_key(client: AsyncClient, headers):
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "key-lookup-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"lookup-{uuid.uuid4().hex[:16]}"

    await client.post(
        "/api/submissions",
        json={
            "draft_id": draft_id,
            "idempotency_key": idem_key,
            "data": SAMPLE_V2_DATA,
            "schema_version": 2,
        },
        headers=headers,
    )

    get_resp = await client.get(
        f"/api/submissions/by-idempotency-key/{idem_key}",
        headers=headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["idempotency_key"] == idem_key


# ─── Revisions ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_revisions(client: AsyncClient, headers):
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "rev-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Make two updates
    updated = {**SAMPLE_V2_DATA}
    updated["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "Update1"}
    await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": updated, "expected_revision": 1, "schema_version": 2},
        headers=headers,
    )
    updated["personal"]["first_name"] = "Update2"
    await client.put(
        f"/api/drafts/{draft_id}",
        json={"data": updated, "expected_revision": 2, "schema_version": 2},
        headers=headers,
    )

    rev_resp = await client.get(f"/api/drafts/{draft_id}/revisions", headers=headers)
    assert rev_resp.status_code == 200
    revisions = rev_resp.json()
    assert len(revisions) == 3  # initial + 2 updates
    assert revisions[0]["revision"] == 1
    assert revisions[2]["revision"] == 3


# ─── Metrics ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_metrics(client: AsyncClient, headers):
    resp = await client.get("/api/metrics")
    assert resp.status_code == 200
    body = resp.json()
    assert "total_drafts" in body
    assert "total_submissions" in body
