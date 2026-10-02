from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any, List
from datetime import datetime

# --- Auth Schemas ---
class NonceResponse(BaseModel):
    nonce: str
    issued_at: datetime
    expires_at: datetime

class VerifySignatureRequest(BaseModel):
    message: str
    signature: str

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    identity_id: str
    active_wallet: Optional[str] = None
    role: str
    kyc_status: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# --- KYC Schemas ---
class KYCVerifyRequest(BaseModel):
    national_id_number: str = Field(..., min_length=4)
    full_name: str

class KYCVerifyResponse(BaseModel):
    identity_id: str
    kyc_reference: str
    kyc_status: str

class WalletRecoveryRequest(BaseModel):
    identity_id: str
    old_wallet: str
    new_wallet: str

# --- Application Schemas ---
class DraftApplicationCreate(BaseModel):
    jurisdiction_id: int
    state: str
    district: str
    taluka: str
    village: str
    survey_number: str
    subdivision: str = "0"
    geojson: Dict[str, Any]

class ApplicationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    applicant_identity_id: str
    jurisdiction_id: int
    state: str
    district: str
    taluka: str
    village: str
    survey_number: str
    subdivision: str
    canonical_identifier: str
    parcel_key: str
    geometry_hash: str
    area_sq_meters: float
    status: str
    has_spatial_overlap: bool
    overlap_notes: Optional[str] = None
    created_at: datetime

class InspectorReviewRequest(BaseModel):
    decision: str # APPROVED, REJECTED
    reason: Optional[str] = None

# --- Land Read-Model Schemas ---
class LandItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    land_id: int
    parcel_key: str
    owner_identity_id: str
    jurisdiction_id: int
    status: str
    geometry_hash: str
    document_manifest_hash: str
    registered_block: int

class PaginatedLandResponse(BaseModel):
    total: int
    page: int
    size: int
    items: List[LandItemResponse]

# --- Document Schemas ---
class DocumentItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    application_id: Optional[str] = None
    document_type: str
    file_name: str
    mime_type: str
    file_size_bytes: int
    sha256_hash: str
    version: int
    status: str
    uploaded_at: datetime

class ManifestResponse(BaseModel):
    application_id: str
    manifest_hash: str # SHA-256 (0x...)
    documents_count: int
    manifest_json: List[Dict[str, Any]]

class PresignedDownloadResponse(BaseModel):
    document_id: str
    file_name: str
    download_url: str
    expires_in_seconds: int

class DocumentVerificationResponse(BaseModel):
    status: str # INTACT, TAMPERED
    total_documents: int
    tampered_count: int
    tampered_documents: List[Dict[str, Any]]
    checked_documents: List[Dict[str, Any]]
    stored_db_manifest_hash: Optional[str] = None
    computed_storage_manifest_hash: str
    manifest_integrity: str # INTACT, CORRUPTED
    on_chain_manifest_hash: Optional[str] = None
    on_chain_integrity: Optional[str] = None

