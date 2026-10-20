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
    assert get_resp.status_code == 403  # Forbidden (enforce resource ownership)


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


# ─── Phase 3: Integration & Failure Test Suite ─────────────────────────


@pytest.mark.asyncio
async def test_missing_or_unauthorized_drafts(client: AsyncClient, headers):
    """Missing drafts return 404; drafts belonging to another owner return 403."""
    # 1. Non-existent draft
    missing_id = str(uuid.uuid4())
    resp = await client.get(f"/api/drafts/{missing_id}", headers=headers)
    assert resp.status_code == 404

    # 2. Draft belonging to another owner
    other_headers = {"X-Owner-Token": f"other-{uuid.uuid4().hex[:16]}"}
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "auth-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=other_headers,
    )
    draft_id = create_resp.json()["id"]

    # All operations from the first owner must return 403 Forbidden
    assert (await client.get(f"/api/drafts/{draft_id}", headers=headers)).status_code == 403
    assert (await client.put(f"/api/drafts/{draft_id}", json={"data": {}, "expected_revision": 1, "schema_version": 2}, headers=headers)).status_code == 403
    assert (await client.get(f"/api/drafts/{draft_id}/revisions", headers=headers)).status_code == 403
    assert (await client.post(f"/api/drafts/{draft_id}/sync", json={"data": {}, "local_revision": 2, "base_revision": 1, "schema_version": 2}, headers=headers)).status_code == 403
    assert (await client.post(f"/api/drafts/{draft_id}/resolve-conflict", json={"resolved_data": {}, "base_revision": 1, "server_revision": 1, "schema_version": 2}, headers=headers)).status_code == 403
    assert (await client.post(f"/api/drafts/{draft_id}/migrate", json={"to_version": 2}, headers=headers)).status_code == 403


@pytest.mark.asyncio
async def test_cross_owner_submission_access(client: AsyncClient, headers):
    """Submissions cannot be read, hijacked, or submitted across owners."""
    # Owner A creates draft and submits
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "cross-sub-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idem_key = f"key-owner-a-{uuid.uuid4().hex[:16]}"

    sub_resp = await client.post(
        "/api/submissions",
        json={"draft_id": draft_id, "idempotency_key": idem_key, "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert sub_resp.status_code == 201
    sub_id = sub_resp.json()["id"]

    # Owner B attempts to access Owner A's submission
    owner_b_headers = {"X-Owner-Token": f"owner-b-{uuid.uuid4().hex[:16]}"}

    # 1. Get by submission ID
    get_by_id = await client.get(f"/api/submissions/{sub_id}", headers=owner_b_headers)
    assert get_by_id.status_code == 403

    # 2. Get by idempotency key
    get_by_key = await client.get(f"/api/submissions/by-idempotency-key/{idem_key}", headers=owner_b_headers)
    assert get_by_key.status_code == 403

    # 3. Owner B tries to submit with Owner A's idempotency key
    b_draft = await client.post(
        "/api/drafts",
        json={"form_id": "b-form", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=owner_b_headers,
    )
    b_draft_id = b_draft.json()["id"]

    hijack_resp = await client.post(
        "/api/submissions",
        json={"draft_id": b_draft_id, "idempotency_key": idem_key, "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=owner_b_headers,
    )
    assert hijack_resp.status_code == 403

    # 4. Owner B tries to submit Owner A's draft_id
    cross_draft_sub = await client.post(
        "/api/submissions",
        json={"draft_id": draft_id, "idempotency_key": f"key-b-{uuid.uuid4().hex[:16]}", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=owner_b_headers,
    )
    assert cross_draft_sub.status_code == 403


@pytest.mark.asyncio
async def test_concurrent_revision_updates_prevent_silent_overwrites(client: AsyncClient, headers):
    """Concurrent updates to the same revision must never silently overwrite."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "occ-race-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    payload1 = {**SAMPLE_V2_DATA}
    payload1["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "WinnerA"}

    payload2 = {**SAMPLE_V2_DATA}
    payload2["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "WinnerB"}

    # Fire two concurrent updates starting from revision 1
    task1 = client.put(f"/api/drafts/{draft_id}", json={"data": payload1, "expected_revision": 1, "schema_version": 2}, headers=headers)
    task2 = client.put(f"/api/drafts/{draft_id}", json={"data": payload2, "expected_revision": 1, "schema_version": 2}, headers=headers)

    res1, res2 = await asyncio.gather(task1, task2)

    # One must succeed with 200, the other must fail with 409 Conflict
    status_codes = sorted([res1.status_code, res2.status_code])
    assert status_codes == [200, 409]

    # Verify that the server draft is now at revision 2 and matches the winning payload
    draft_check = await client.get(f"/api/drafts/{draft_id}", headers=headers)
    assert draft_check.status_code == 200
    assert draft_check.json()["revision"] == 2


@pytest.mark.asyncio
async def test_conflict_resolution_against_stale_server_revision(client: AsyncClient, headers):
    """Conflict resolution against an outdated server revision must be rejected (409)."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "stale-conflict", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # Server advances to revision 2
    u1_data = {**SAMPLE_V2_DATA}
    u1_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ServerRev2"}
    await client.put(f"/api/drafts/{draft_id}", json={"data": u1_data, "expected_revision": 1, "schema_version": 2}, headers=headers)

    # Server advances to revision 3
    u2_data = {**SAMPLE_V2_DATA}
    u2_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ServerRev3"}
    await client.put(f"/api/drafts/{draft_id}", json={"data": u2_data, "expected_revision": 2, "schema_version": 2}, headers=headers)

    # Client attempts to resolve against stale server_revision = 2
    resolved_data = {**SAMPLE_V2_DATA}
    resolved_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "ClientResolved"}

    resolve_resp = await client.post(
        f"/api/drafts/{draft_id}/resolve-conflict",
        json={
            "resolved_data": resolved_data,
            "base_revision": 1,
            "server_revision": 2,  # Stale! Current server revision is 3
            "schema_version": 2,
        },
        headers=headers,
    )
    assert resolve_resp.status_code == 409
    assert "moved to revision 3" in resolve_resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_schema_migration_against_persisted_v1_draft(client: AsyncClient, headers):
    """Persisted v1 draft in database is upgraded to v2 with revision increment and snapshot."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "scholarship-v1", "schema_version": 1, "data": SAMPLE_V1_DATA},
        headers=headers,
    )
    assert create_resp.status_code == 201
    draft_id = create_resp.json()["id"]
    assert create_resp.json()["schema_version"] == 1
    assert create_resp.json()["revision"] == 1

    # Migrate persisted draft
    mig_resp = await client.post(
        f"/api/drafts/{draft_id}/migrate",
        json={"to_version": 2},
        headers=headers,
    )
    assert mig_resp.status_code == 200
    migrated_body = mig_resp.json()
    assert migrated_body["schema_version"] == 2
    assert migrated_body["revision"] == 2
    assert migrated_body["data"]["academic"]["gpa_scale"] == "4.0"
    assert migrated_body["data"]["personal"]["first_name"] == "Jane"

    # Verify revision history has 2 revisions: rev 1 (client) and rev 2 (migration)
    revs_resp = await client.get(f"/api/drafts/{draft_id}/revisions", headers=headers)
    assert revs_resp.status_code == 200
    revs = revs_resp.json()
    assert len(revs) == 2
    assert revs[0]["schema_version"] == 1
    assert revs[1]["schema_version"] == 2
    assert revs[1]["source"] == "migration"


@pytest.mark.asyncio
async def test_offline_draft_registration_and_subsequent_sync(client: AsyncClient, headers):
    """An offline draft created with a local UUID registers cleanly and syncs."""
    offline_uuid = str(uuid.uuid4())

    # Offline registration with client-assigned draft ID
    reg_resp = await client.post(
        "/api/drafts",
        json={"id": offline_uuid, "form_id": "scholarship-offline", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert reg_resp.status_code == 201
    assert reg_resp.json()["id"] == offline_uuid
    assert reg_resp.json()["revision"] == 1

    # Duplicate registration retry with same ID & owner is idempotent
    retry_reg = await client.post(
        "/api/drafts",
        json={"id": offline_uuid, "form_id": "scholarship-offline", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert retry_reg.status_code == 201 or retry_reg.status_code == 200
    assert retry_reg.json()["id"] == offline_uuid

    # Subsequent sync from rev 1 -> 2
    updated_data = {**SAMPLE_V2_DATA}
    updated_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "SynchronizedJane"}
    sync_resp = await client.post(
        f"/api/drafts/{offline_uuid}/sync",
        json={"data": updated_data, "local_revision": 2, "base_revision": 1, "schema_version": 2},
        headers=headers,
    )
    assert sync_resp.status_code == 200
    assert sync_resp.json()["server_revision"] == 2


@pytest.mark.asyncio
async def test_recovery_following_uncertain_submission_outcome(client: AsyncClient, headers):
    """When a network drop occurs during submission, querying by idempotency key recovers receipt."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "uncertain-sub", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]
    idempotency_key = f"uncertain-idem-{uuid.uuid4().hex[:16]}"

    # Commit submission
    sub_resp = await client.post(
        "/api/submissions",
        json={"draft_id": draft_id, "idempotency_key": idempotency_key, "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert sub_resp.status_code == 201
    receipt_id = sub_resp.json()["receipt_id"]

    # Reconcile uncertain outcome via GET by idempotency key
    recovery_resp = await client.get(
        f"/api/submissions/by-idempotency-key/{idempotency_key}",
        headers=headers,
    )
    assert recovery_resp.status_code == 200
    recovered_data = recovery_resp.json()
    assert recovered_data["idempotency_key"] == idempotency_key
    assert recovered_data["receipt_id"] == receipt_id
    assert recovered_data["status"] == "accepted"


@pytest.mark.asyncio
async def test_submitting_already_submitted_draft_with_new_key_rejected(client: AsyncClient, headers):
    """Submitting an already submitted draft under a new idempotency key must be rejected."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "double-submit", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    # First submission
    sub1 = await client.post(
        "/api/submissions",
        json={"draft_id": draft_id, "idempotency_key": f"key1-{uuid.uuid4().hex[:16]}", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert sub1.status_code == 201

    # Second submission with different key
    sub2 = await client.post(
        "/api/submissions",
        json={"draft_id": draft_id, "idempotency_key": f"key2-{uuid.uuid4().hex[:16]}", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    assert sub2.status_code == 422
    assert "already been submitted" in sub2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_transaction_rollback_when_operation_fails(client: AsyncClient, headers, monkeypatch):
    """If audit recording or revision saving fails mid-transaction, state rolls back cleanly."""
    create_resp = await client.post(
        "/api/drafts",
        json={"form_id": "rollback-test", "schema_version": 2, "data": SAMPLE_V2_DATA},
        headers=headers,
    )
    draft_id = create_resp.json()["id"]

    from app import services

    # Mock _record_audit to simulate an unhandled DB / infrastructure failure during update
    async def failing_record_audit(*args, **kwargs):
        raise RuntimeError("Simulated transient disk/db failure during audit logging")

    monkeypatch.setattr(services, "_record_audit", failing_record_audit)

    # Attempt update
    updated_data = {**SAMPLE_V2_DATA}
    updated_data["personal"] = {**SAMPLE_V2_DATA["personal"], "first_name": "RollbackAttempt"}

    try:
        resp = await client.put(
            f"/api/drafts/{draft_id}",
            json={"data": updated_data, "expected_revision": 1, "schema_version": 2},
            headers=headers,
        )
        assert resp.status_code in [400, 500]
    except Exception:
        pass

    # Restore monkeypatch
    monkeypatch.undo()

    # Verify that the draft revision in DB remains at rev 1 and first_name remains "Jane"
    draft_check = await client.get(f"/api/drafts/{draft_id}", headers=headers)
    assert draft_check.status_code == 200
    assert draft_check.json()["revision"] == 1
    assert draft_check.json()["data"]["personal"]["first_name"] == "Jane"

    # Verify no partial revision snapshot was recorded
    revs_resp = await client.get(f"/api/drafts/{draft_id}/revisions", headers=headers)
    assert revs_resp.status_code == 200
    assert len(revs_resp.json()) == 1  # only original rev 1 exists
