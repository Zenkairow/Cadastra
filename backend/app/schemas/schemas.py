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

# --- Geospatial Schemas ---
class BoundingBox(BaseModel):
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

class GeoJSONValidationRequest(BaseModel):
    geojson: Dict[str, Any]

class GeoJSONValidationResponse(BaseModel):
    is_valid: bool
    area_sq_meters: float
    area_hectares: float
    area_acres: float
    canonical_geojson: Dict[str, Any]
    geometry_hash: str
    bounding_box: BoundingBox

class OverlapCheckRequest(BaseModel):
    geojson: Dict[str, Any]
    exclude_application_id: Optional[str] = None
    exclude_land_id: Optional[int] = None

class ConflictDetail(BaseModel):
    parcel_id: Optional[Any] = None
    parcel_key: Optional[str] = None
    overlap_type: str # EXACT_OVERLAP, PARTIAL_OVERLAP, NEAR_OVERLAP, SHARED_BOUNDARY, DISJOINT
    is_overlap: bool
    severity: str # CRITICAL, WARNING, INFO, CLEAR
    intersection_area_sqm: float
    overlap_pct_candidate: float
    overlap_pct_registered: float
    distance_meters: float
    details: str

class OverlapCheckResponse(BaseModel):
    has_overlap: bool
    severity: str # CLEAR, WARNING, CRITICAL, INFO
    candidate_area_sqm: float
    conflict_count: int
    conflicts: List[ConflictDetail]

class GeometryIntegrityResponse(BaseModel):
    parcel_id: Any
    stored_geometry_hash: str
    recomputed_geometry_hash: str
    is_intact: bool
    status: str # MATCH, DRIFT_DETECTED

# --- Escrow Read-Model Schemas ---
class EscrowItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    request_id: int
    land_id: int
    buyer_identity_id: str
    seller_identity_id: str
    buyer_wallet: Optional[str] = None
    agreed_price: float
    deposit_amount: float
    state: str
    approval_count: int
    has_senior_approval: bool
    expires_at: datetime
    funded_at: Optional[datetime] = None
    settled_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    cancellation_reason: Optional[str] = None

# --- System & Audit Schemas ---
class SyncStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contract_name: str
    contract_address: str
    chain_id: int
    last_processed_block: int
    updated_at: datetime

class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    action: str
    actor_identity_id: Optional[str] = None
    actor_wallet: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    timestamp: datetime



