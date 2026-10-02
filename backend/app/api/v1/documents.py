from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import Optional, List
import io

from backend.app.database import get_db
from backend.app.models.models import Document, DocumentManifest, LandApplication, AuditLog, User
from backend.app.schemas.schemas import (
    DocumentItemResponse, ManifestResponse, PresignedDownloadResponse, DocumentVerificationResponse
)
from backend.app.api.dependencies import get_current_user
from backend.app.services.document_security import validate_document_security
from backend.app.services.storage_service import storage_service, compute_stream_sha256
from backend.app.services.manifest_service import manifest_service
from backend.app.services.tamper_service import tamper_service
from backend.app.config import settings

router = APIRouter(prefix="/documents", tags=["Documents"])

@router.post("/upload", response_model=DocumentItemResponse)
async def upload_document(
    application_id: str = Form(...),
    document_type: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Secure document upload pipeline:
    1. Authorization & ownership check.
    2. Magic-byte MIME type validation (preventing file extension spoofing).
    3. Constant-memory streaming SHA-256 calculation.
    4. Object storage persistence (MinIO/S3).
    5. Version incrementation (never overwriting previous files).
    6. Canonical document manifest recalculation.
    """
    # 1. Ownership & application validity check
    app_stmt = select(LandApplication).where(LandApplication.id == application_id)
    app_res = await db.execute(app_stmt)
    app = app_res.scalar_one_or_none()

    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Land application not found")

    is_inspector_or_admin = current_user.role in ("INSPECTOR", "SENIOR_INSPECTOR", "REGISTRAR", "ADMIN")
    is_owner = (app.applicant_identity_id == current_user.identity_id)

    if not is_owner and not is_inspector_or_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized to upload documents for this application")

    # 2. Inspect magic bytes for security validation
    header_chunk = await file.read(1024)
    file_size = file.size if file.size is not None else -1
    
    # Calculate file size if not provided by browser header
    if file_size <= 0:
        await file.seek(0, 2) # Seek to end
        file_size = await file.tell()

    await file.seek(0)

    try:
        actual_mime = validate_document_security(
            header_bytes=header_chunk,
            claimed_mime=file.content_type or "",
            file_size=file_size,
            doc_type=document_type
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 3. Compute SHA-256 in constant memory buffer
    file_bytes = await file.read()
    sha256_hash = compute_stream_sha256(file_bytes)

    # 4. Check previous versions
    prev_stmt = (
        select(Document)
        .where(
            Document.application_id == application_id,
            Document.document_type == document_type.upper(),
            Document.status == "AVAILABLE"
        )
        .order_by(Document.version.desc())
    )
    prev_res = await db.execute(prev_stmt)
    latest_prev = prev_res.scalars().first()

    version = 1
    if latest_prev:
        version = latest_prev.version + 1
        latest_prev.status = "REPLACED"

    # 5. Store file in object storage
    clean_filename = file.filename.replace(" ", "_") if file.filename else "document"
    storage_key = f"applications/{application_id}/{document_type.upper()}_v{version}_{clean_filename}"
    storage_service.put_object(storage_key, file_bytes, content_type=actual_mime)

    # 6. Insert new Document record
    new_doc = Document(
        application_id=application_id,
        document_type=document_type.upper(),
        file_name=clean_filename,
        mime_type=actual_mime,
        file_size_bytes=file_size,
        storage_key=storage_key,
        sha256_hash=sha256_hash,
        version=version,
        status="AVAILABLE"
    )
    db.add(new_doc)
    await db.flush()

    # 7. Rebuild canonical manifest for this land application
    await manifest_service.generate_and_save_manifest(db, application_id)
    await db.commit()
    await db.refresh(new_doc)

    return new_doc

@router.get("/{document_id}/download-url", response_model=PresignedDownloadResponse)
async def get_download_url(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Issues short-lived signed download URL after verifying user authorization.
    Logs every file access in audit_logs.
    """
    stmt = select(Document).where(Document.id == document_id)
    res = await db.execute(stmt)
    doc = res.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Authorization
    is_authorized = False
    if current_user.role in ("INSPECTOR", "SENIOR_INSPECTOR", "REGISTRAR", "ADMIN"):
        is_authorized = True
    elif doc.application_id:
        app_stmt = select(LandApplication).where(LandApplication.id == doc.application_id)
        app_res = await db.execute(app_stmt)
        app = app_res.scalar_one_or_none()
        if app and app.applicant_identity_id == current_user.identity_id:
            is_authorized = True

    if not is_authorized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to document")

    expires_in = settings.DOCUMENT_SIGNED_URL_EXPIRE_SECONDS
    download_url = storage_service.generate_presigned_download_url(doc.storage_key, expires_in=expires_in)

    # Access Audit Log
    audit = AuditLog(
        action="DOCUMENT_ACCESSED",
        actor_identity_id=current_user.identity_id,
        actor_wallet=current_user.active_wallet,
        details={"document_id": doc.id, "file_name": doc.file_name, "version": doc.version}
    )
    db.add(audit)
    await db.commit()

    return PresignedDownloadResponse(
        document_id=doc.id,
        file_name=doc.file_name,
        download_url=download_url,
        expires_in_seconds=expires_in
    )

@router.get("/manifest/{application_id}", response_model=ManifestResponse)
async def get_application_manifest(
    application_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Returns canonical document manifest JSON and manifest SHA-256 hash."""
    stmt = select(DocumentManifest).where(DocumentManifest.application_id == application_id)
    res = await db.execute(stmt)
    manifest = res.scalar_one_or_none()

    if not manifest:
        # Generate on demand
        manifest = await manifest_service.generate_and_save_manifest(db, application_id)
        await db.commit()

    return ManifestResponse(
        application_id=application_id,
        manifest_hash=manifest.manifest_hash,
        documents_count=len(manifest.manifest_json),
        manifest_json=manifest.manifest_json
    )

@router.get("/verify/{application_id}", response_model=DocumentVerificationResponse)
async def verify_application_documents(
    application_id: str,
    on_chain_manifest_hash: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Cryptographic verification endpoint:
    Re-hashes stored objects in constant memory, reconstructs manifest,
    and flags any byte corruption or tampering against DB and on-chain hashes.
    """
    report = await tamper_service.verify_application_documents(
        session=db,
        application_id=application_id,
        on_chain_manifest_hash=on_chain_manifest_hash
    )
    return report

@router.get("/raw/{key:path}")
async def get_raw_local_file(key: str):
    """Direct streaming endpoint for local storage mode."""
    if not storage_service.object_exists(key):
        raise HTTPException(status_code=404, detail="File not found")
    stream = storage_service.get_object_stream(key)
    return StreamingResponse(stream, media_type="application/octet-stream")
