import json
import hashlib
from typing import List, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.models.models import Document, DocumentManifest

def build_canonical_manifest(documents: List[Document]) -> Tuple[List[Dict[str, Any]], str, str]:
    """
    Builds an order-independent, canonically serialized document manifest.
    Returns: (items_list, canonical_json_str, sha256_manifest_hash)
    """
    items = []
    for doc in documents:
        items.append({
            "doc_id": str(doc.id),
            "doc_type": str(doc.document_type),
            "file_name": str(doc.file_name),
            "sha256": str(doc.sha256_hash).lower(),
            "version": int(doc.version)
        })

    # Sort deterministically by doc_id to ensure order independence
    items.sort(key=lambda x: x["doc_id"])

    # Serialize with sorted keys, UTF-8, and no insignificant whitespace
    canonical_json = json.dumps(items, sort_keys=True, separators=(",", ":"))
    manifest_hash = "0x" + hashlib.sha256(canonical_json.encode("utf-8")).hexdigest().lower()

    return items, canonical_json, manifest_hash

class ManifestService:
    """Manages document manifest construction and hash anchoring."""

    async def generate_and_save_manifest(self, session: AsyncSession, application_id: str) -> DocumentManifest:
        """
        Fetches all AVAILABLE documents for application_id, builds canonical manifest,
        and saves/updates DocumentManifest row.
        """
        stmt = (
            select(Document)
            .where(Document.application_id == application_id, Document.status == "AVAILABLE")
        )
        res = await session.execute(stmt)
        docs = res.scalars().all()

        items, canonical_json, manifest_hash = build_canonical_manifest(docs)

        # Find existing or create new manifest record
        man_stmt = select(DocumentManifest).where(DocumentManifest.application_id == application_id)
        man_res = await session.execute(man_stmt)
        manifest = man_res.scalar_one_or_none()

        if not manifest:
            manifest = DocumentManifest(
                application_id=application_id,
                manifest_json=items,
                manifest_hash=manifest_hash
            )
            session.add(manifest)
        else:
            manifest.manifest_json = items
            manifest.manifest_hash = manifest_hash

        await session.flush()
        return manifest

manifest_service = ManifestService()
