import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.models.models import Document, DocumentManifest, Land
from backend.app.services.storage_service import storage_service, compute_stream_sha256
from backend.app.services.manifest_service import build_canonical_manifest

logger = logging.getLogger("tamper_verifier")

class TamperVerificationService:
    """
    Cryptographic verification service that re-hashes physical file objects,
    re-derives the canonical document manifest, and detects any data corruption
    or tampering against on-chain and database commitments.
    """
    async def verify_application_documents(
        self,
        session: AsyncSession,
        application_id: str,
        on_chain_manifest_hash: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Re-reads stored document bytes from object storage in constant memory,
        recomputes SHA-256 hashes, and cross-checks against DB and on-chain records.
        """
        stmt = (
            select(Document)
            .where(Document.application_id == application_id, Document.status == "AVAILABLE")
        )
        res = await session.execute(stmt)
        docs = res.scalars().all()

        checked_docs = []
        tampered_docs = []
        verified_docs_for_manifest = []

        for doc in docs:
            try:
                stream = storage_service.get_object_stream(doc.storage_key)
                actual_sha256 = compute_stream_sha256(stream)
                if hasattr(stream, "close"):
                    stream.close()

                is_intact = (actual_sha256.lower() == doc.sha256_hash.lower())
                doc_info = {
                    "doc_id": doc.id,
                    "document_type": doc.document_type,
                    "file_name": doc.file_name,
                    "expected_sha256": doc.sha256_hash.lower(),
                    "computed_sha256": actual_sha256.lower(),
                    "status": "INTACT" if is_intact else "TAMPERED"
                }
                checked_docs.append(doc_info)

                if not is_intact:
                    tampered_docs.append(doc_info)
                    logger.warning(
                        f"TAMPER DETECTED on Document {doc.id} ({doc.file_name}): "
                        f"Expected {doc.sha256_hash}, Got {actual_sha256}"
                    )
                
                # Clone doc with actual computed hash to re-derive manifest
                doc_copy = Document(
                    id=doc.id,
                    document_type=doc.document_type,
                    file_name=doc.file_name,
                    sha256_hash=actual_sha256.lower(),
                    version=doc.version
                )
                verified_docs_for_manifest.append(doc_copy)

            except Exception as e:
                err_info = {
                    "doc_id": doc.id,
                    "document_type": doc.document_type,
                    "file_name": doc.file_name,
                    "error": str(e),
                    "status": "MISSING_OR_CORRUPT"
                }
                checked_docs.append(err_info)
                tampered_docs.append(err_info)

        # Re-derive manifest from actual stored files
        _, _, computed_manifest_hash = build_canonical_manifest(verified_docs_for_manifest)

        # Get DB manifest
        man_stmt = select(DocumentManifest).where(DocumentManifest.application_id == application_id)
        man_res = await session.execute(man_stmt)
        stored_manifest = man_res.scalar_one_or_none()

        db_manifest_hash = stored_manifest.manifest_hash.lower() if stored_manifest else None
        db_manifest_match = (db_manifest_hash == computed_manifest_hash.lower()) if db_manifest_hash else False

        on_chain_status = "NOT_SPECIFIED"
        on_chain_match = None
        if on_chain_manifest_hash:
            on_chain_match = (on_chain_manifest_hash.lower() == computed_manifest_hash.lower())
            on_chain_status = "MATCH" if on_chain_match else "MISMATCH"

        is_overall_intact = (len(tampered_docs) == 0) and db_manifest_match and (on_chain_match is not False)

        return {
            "status": "INTACT" if is_overall_intact else "TAMPERED",
            "total_documents": len(docs),
            "tampered_count": len(tampered_docs),
            "tampered_documents": tampered_docs,
            "checked_documents": checked_docs,
            "stored_db_manifest_hash": db_manifest_hash,
            "computed_storage_manifest_hash": computed_manifest_hash.lower(),
            "manifest_integrity": "INTACT" if db_manifest_match else "CORRUPTED",
            "on_chain_manifest_hash": on_chain_manifest_hash.lower() if on_chain_manifest_hash else None,
            "on_chain_integrity": on_chain_status
        }

tamper_service = TamperVerificationService()
