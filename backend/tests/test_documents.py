import pytest
import pytest_asyncio
import io
from sqlalchemy import select

from backend.app.models.models import User, LandApplication, Document, DocumentManifest, AuditLog
from backend.app.services.auth_service import auth_service
from backend.app.services.storage_service import storage_service, compute_stream_sha256
from backend.app.services.manifest_service import manifest_service

import uuid
from backend.app.models.models import Jurisdiction

@pytest_asyncio.fixture
async def setup_applicant(db_session, test_wallet):
    # Ensure test jurisdiction exists
    jur = await db_session.get(Jurisdiction, 101)
    if not jur:
        jur = Jurisdiction(id=101, name="Pune Haveli", state="Maharashtra", district="Pune")
        db_session.add(jur)
        await db_session.flush()

    uid = uuid.uuid4().hex
    identity_id = "0x" + uid + uid
    wallet_addr = test_wallet.address.lower()

    user = User(
        identity_id=identity_id,
        active_wallet=wallet_addr,
        role="CITIZEN",
        kyc_status="VERIFIED"
    )
    db_session.add(user)
    await db_session.flush()

    token = auth_service.create_access_token(user.identity_id, user.active_wallet, user.role)

    # Create dummy application
    app = LandApplication(
        applicant_identity_id=user.identity_id,
        jurisdiction_id=101,
        state="Maharashtra",
        district="Pune",
        taluka="Haveli",
        village="Kharadi",
        survey_number=f"SN-{uid[:6]}",
        subdivision="0",
        canonical_identifier=f"MAHARASHTRA|PUNE|HAVELI|KHARADI|{uid[:6]}|0",
        parcel_key="0x" + uid + uid,
        status="DRAFT"
    )
    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)

    return user, app, token

@pytest_asyncio.fixture
async def setup_other_user(db_session):
    uid = uuid.uuid4().hex
    other = User(
        identity_id="0x" + uid + uid,
        active_wallet=f"0x{uid[:40]}",
        role="CITIZEN",
        kyc_status="VERIFIED"
    )
    db_session.add(other)
    await db_session.commit()
    token = auth_service.create_access_token(other.identity_id, other.active_wallet, other.role)
    return other, token

@pytest.mark.asyncio
async def test_streaming_sha256_constant_memory():
    """Validates that constant-memory chunked hashing matches in-memory hash."""
    sample_content = b"%PDF-1.4 " + b"X" * 100000
    stream = io.BytesIO(sample_content)
    
    hash_stream = compute_stream_sha256(stream, chunk_size=1024)
    hash_bytes = compute_stream_sha256(sample_content)
    
    assert hash_stream == hash_bytes
    assert hash_stream.startswith("0x")
    assert len(hash_stream) == 66

@pytest.mark.asyncio
async def test_upload_document_success_and_magic_byte_validation(client, setup_applicant, db_session):
    """Uploads valid PDF sale deed and verifies manifest generation."""
    user, app, token = setup_applicant
    headers = {"Authorization": f"Bearer {token}"}

    pdf_content = b"%PDF-1.5 Valid deed content with legal text and stamps"
    files = {"file": ("deed.pdf", pdf_content, "application/pdf")}
    data = {"application_id": app.id, "document_type": "SALE_DEED"}

    response = await client.post("/api/v1/documents/upload", headers=headers, data=data, files=files)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["document_type"] == "SALE_DEED"
    assert res_data["version"] == 1
    assert res_data["status"] == "AVAILABLE"
    assert res_data["sha256_hash"].startswith("0x")

    # Verify document in storage
    doc_id = res_data["id"]
    doc = (await db_session.execute(select(Document).where(Document.id == doc_id))).scalar_one()
    assert storage_service.object_exists(doc.storage_key)

    # Verify manifest was automatically generated
    manifest = (await db_session.execute(
        select(DocumentManifest).where(DocumentManifest.application_id == app.id)
    )).scalar_one()
    assert manifest.manifest_hash.startswith("0x")
    assert len(manifest.manifest_json) == 1
    assert manifest.manifest_json[0]["doc_id"] == doc_id

@pytest.mark.asyncio
async def test_upload_spoofed_mime_type_rejected(client, setup_applicant):
    """Rejects malicious file pretending to be PDF (magic bytes check)."""
    user, app, token = setup_applicant
    headers = {"Authorization": f"Bearer {token}"}

    # Malicious executable payload pretending to be a PDF
    fake_pdf = b"MZ\x90\x00Executable binary payload disguised as deed"
    files = {"file": ("deed.pdf", fake_pdf, "application/pdf")}
    data = {"application_id": app.id, "document_type": "SALE_DEED"}

    response = await client.post("/api/v1/documents/upload", headers=headers, data=data, files=files)
    assert response.status_code == 400
    assert "MIME type spoofing detected" in response.json()["detail"] or "magic bytes" in response.json()["detail"].lower()

@pytest.mark.asyncio
async def test_document_versioning_pipeline(client, setup_applicant, db_session):
    """Validates that uploading updated document increments version and marks old version REPLACED."""
    user, app, token = setup_applicant
    headers = {"Authorization": f"Bearer {token}"}

    # Upload version 1
    pdf_v1 = b"%PDF-1.4 Initial deed draft"
    files1 = {"file": ("deed_v1.pdf", pdf_v1, "application/pdf")}
    data1 = {"application_id": app.id, "document_type": "SALE_DEED"}
    res1 = await client.post("/api/v1/documents/upload", headers=headers, data=data1, files=files1)
    assert res1.status_code == 200
    doc1_id = res1.json()["id"]
    assert res1.json()["version"] == 1

    # Upload version 2 (updated scan)
    pdf_v2 = b"%PDF-1.4 Amended deed draft with registrar stamp"
    files2 = {"file": ("deed_v2.pdf", pdf_v2, "application/pdf")}
    data2 = {"application_id": app.id, "document_type": "SALE_DEED"}
    res2 = await client.post("/api/v1/documents/upload", headers=headers, data=data2, files=files2)
    assert res2.status_code == 200
    doc2_id = res2.json()["id"]
    assert res2.json()["version"] == 2

    # Check database status
    doc1 = (await db_session.execute(select(Document).where(Document.id == doc1_id))).scalar_one()
    doc2 = (await db_session.execute(select(Document).where(Document.id == doc2_id))).scalar_one()
    assert doc1.status == "REPLACED"
    assert doc2.status == "AVAILABLE"

    # Both objects must exist independently in storage (never overwritten)
    assert storage_service.object_exists(doc1.storage_key)
    assert storage_service.object_exists(doc2.storage_key)
    assert doc1.storage_key != doc2.storage_key

@pytest.mark.asyncio
async def test_secure_download_url_and_audit_logging(client, setup_applicant, setup_other_user, db_session):
    """Ensures unauthorized citizens cannot download documents and authorized downloads log audits."""
    user, app, token = setup_applicant
    other_user, other_token = setup_other_user

    # Upload document
    pdf_content = b"%PDF-1.4 Private 7/12 extract"
    files = {"file": ("extract_7_12.pdf", pdf_content, "application/pdf")}
    data = {"application_id": app.id, "document_type": "7_12_EXTRACT"}
    upload_res = await client.post("/api/v1/documents/upload", headers={"Authorization": f"Bearer {token}"}, data=data, files=files)
    doc_id = upload_res.json()["id"]

    # 1. Unauthorized citizen attempts download -> 403 Forbidden
    unauth_res = await client.get(f"/api/v1/documents/{doc_id}/download-url", headers={"Authorization": f"Bearer {other_token}"})
    assert unauth_res.status_code == 403

    # 2. Authorized applicant downloads -> 200 OK
    auth_res = await client.get(f"/api/v1/documents/{doc_id}/download-url", headers={"Authorization": f"Bearer {token}"})
    assert auth_res.status_code == 200
    assert "download_url" in auth_res.json()
    assert auth_res.json()["expires_in_seconds"] == 900

    # 3. Verify audit log entry was written
    audits = (await db_session.execute(
        select(AuditLog).where(AuditLog.action == "DOCUMENT_ACCESSED")
    )).scalars().all()
    assert len(audits) >= 1

@pytest.mark.asyncio
async def test_tamper_detection_experiment_all_profiles(client, setup_applicant, db_session):
    """
    Executes the Master Plan research experiment for Document Integrity (RQ5):
    Tests all 4 corruption profiles:
    - Profile A: 1-byte flip
    - Profile B: Partial truncation / chunk deletion
    - Profile C: Complete file replacement
    - Profile D: On-chain anchored manifest mismatch detection
    """
    user, app, token = setup_applicant
    headers = {"Authorization": f"Bearer {token}"}

    # Upload initial valid document
    original_bytes = b"%PDF-1.4 Pristine Official Land Title Document Content 2026"
    files = {"file": ("title.pdf", original_bytes, "application/pdf")}
    data = {"application_id": app.id, "document_type": "SALE_DEED"}
    upload_res = await client.post("/api/v1/documents/upload", headers=headers, data=data, files=files)
    assert upload_res.status_code == 200
    doc_id = upload_res.json()["id"]

    doc = (await db_session.execute(select(Document).where(Document.id == doc_id))).scalar_one()

    # 1. Baseline Verification: Document is INTACT
    v0_res = await client.get(f"/api/v1/documents/verify/{app.id}")
    assert v0_res.status_code == 200
    assert v0_res.json()["status"] == "INTACT"
    assert v0_res.json()["tampered_count"] == 0
    anchored_manifest_hash = v0_res.json()["stored_db_manifest_hash"]

    # --- Profile A: 1-byte flip in storage ---
    corrupted_bytes_1 = bytearray(original_bytes)
    corrupted_bytes_1[10] ^= 0xFF # Flip 1 byte
    storage_service.put_object(doc.storage_key, bytes(corrupted_bytes_1), content_type="application/pdf")

    v1_res = await client.get(f"/api/v1/documents/verify/{app.id}?on_chain_manifest_hash={anchored_manifest_hash}")
    assert v1_res.json()["status"] == "TAMPERED"
    assert v1_res.json()["tampered_count"] == 1
    assert v1_res.json()["manifest_integrity"] == "CORRUPTED"
    assert v1_res.json()["on_chain_integrity"] == "MISMATCH"

    # --- Profile B: Partial truncation / deletion ---
    truncated_bytes = original_bytes[:15]
    storage_service.put_object(doc.storage_key, truncated_bytes, content_type="application/pdf")

    v2_res = await client.get(f"/api/v1/documents/verify/{app.id}")
    assert v2_res.json()["status"] == "TAMPERED"
    assert v2_res.json()["tampered_count"] == 1

    # --- Profile C: Complete file replacement ---
    fake_file = b"%PDF-1.4 Completely different fraudulent document contents"
    storage_service.put_object(doc.storage_key, fake_file, content_type="application/pdf")

    v3_res = await client.get(f"/api/v1/documents/verify/{app.id}")
    assert v3_res.json()["status"] == "TAMPERED"
    assert v3_res.json()["tampered_count"] == 1

    # --- Restore original file -> Verify returns to INTACT ---
    storage_service.put_object(doc.storage_key, original_bytes, content_type="application/pdf")
    v_clean = await client.get(f"/api/v1/documents/verify/{app.id}?on_chain_manifest_hash={anchored_manifest_hash}")
    assert v_clean.json()["status"] == "INTACT"
    assert v_clean.json()["tampered_count"] == 0
    assert v_clean.json()["on_chain_integrity"] == "MATCH"
