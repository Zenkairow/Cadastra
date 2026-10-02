from sqlalchemy import (
    Column, String, Integer, BigInteger, Boolean, DateTime, Numeric, JSON, ForeignKey, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from backend.app.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    identity_id = Column(String(66), unique=True, nullable=False, index=True) # bytes32 hex (0x...)
    active_wallet = Column(String(42), unique=True, nullable=True, index=True) # 0x...
    role = Column(String(32), nullable=False, default="CITIZEN") # CITIZEN, INSPECTOR, SENIOR_INSPECTOR, REGISTRAR, ADMIN
    kyc_status = Column(String(32), nullable=False, default="PENDING") # PENDING, VERIFIED, REJECTED
    kyc_reference = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    wallet_bindings = relationship("WalletBinding", back_populates="user", cascade="all, delete-orphan")
    applications = relationship("LandApplication", back_populates="applicant")

class WalletBinding(Base):
    __tablename__ = "wallet_bindings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    identity_id = Column(String(66), ForeignKey("users.identity_id"), nullable=False, index=True)
    wallet_address = Column(String(42), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="ACTIVE") # ACTIVE, REVOKED
    activated_at = Column(DateTime(timezone=True), default=utc_now)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="wallet_bindings")

class Jurisdiction(Base):
    __tablename__ = "jurisdictions"

    id = Column(BigInteger, primary_key=True) # e.g. 101, 102
    name = Column(String(100), nullable=False)
    state = Column(String(50), nullable=False)
    district = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)

class LandApplication(Base):
    __tablename__ = "land_applications"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    applicant_identity_id = Column(String(66), ForeignKey("users.identity_id"), nullable=False, index=True)
    jurisdiction_id = Column(BigInteger, ForeignKey("jurisdictions.id"), nullable=False, index=True)
    state = Column(String(50), nullable=False)
    district = Column(String(50), nullable=False)
    taluka = Column(String(50), nullable=False)
    village = Column(String(100), nullable=False)
    survey_number = Column(String(50), nullable=False)
    subdivision = Column(String(50), nullable=False, default="0")
    canonical_identifier = Column(String(255), nullable=False)
    parcel_key = Column(String(66), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="DRAFT") # DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, ON_CHAIN
    has_spatial_overlap = Column(Boolean, default=False)
    overlap_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    applicant = relationship("User", back_populates="applications")
    boundary = relationship("LandBoundary", back_populates="application", uselist=False, cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="application", cascade="all, delete-orphan")

class LandBoundary(Base):
    __tablename__ = "land_boundaries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(String(36), ForeignKey("land_applications.id"), nullable=True, index=True)
    on_chain_land_id = Column(BigInteger, unique=True, nullable=True, index=True)
    area_sq_meters = Column(Numeric(12, 2), nullable=False)
    canonical_geojson = Column(JSON, nullable=False)
    geometry_hash = Column(String(66), nullable=False, index=True) # SHA-256
    created_at = Column(DateTime(timezone=True), default=utc_now)

    application = relationship("LandApplication", back_populates="boundary")

class Document(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(String(36), ForeignKey("land_applications.id"), nullable=True, index=True)
    on_chain_land_id = Column(BigInteger, nullable=True, index=True)
    document_type = Column(String(50), nullable=False) # SALE_DEED, 7_12_EXTRACT, TAX_RECEIPT, SURVEY_MAP
    file_name = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=False)
    storage_key = Column(String(512), nullable=False)
    sha256_hash = Column(String(66), nullable=False)
    version = Column(Integer, default=1)
    status = Column(String(20), default="AVAILABLE") # PENDING, AVAILABLE, REPLACED, DELETED
    uploaded_at = Column(DateTime(timezone=True), default=utc_now)

    application = relationship("LandApplication", back_populates="documents")

class DocumentManifest(Base):
    __tablename__ = "document_manifests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(String(36), ForeignKey("land_applications.id"), nullable=True, index=True)
    on_chain_land_id = Column(BigInteger, nullable=True, index=True)
    manifest_json = Column(JSON, nullable=False)
    manifest_hash = Column(String(66), nullable=False, index=True) # SHA-256
    created_at = Column(DateTime(timezone=True), default=utc_now)

class Inspector(Base):
    __tablename__ = "inspectors"

    address = Column(String(42), primary_key=True) # 0x...
    level = Column(Integer, nullable=False) # 0: ADMIN, 1: REGISTRAR, 2: SENIOR_INSPECTOR, 3: FIELD_INSPECTOR
    jurisdiction_id = Column(BigInteger, nullable=False, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    valid_until = Column(BigInteger, nullable=False) # Unix timestamp
    appointed_by = Column(String(42), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

class SyncState(Base):
    __tablename__ = "sync_state"

    contract_address = Column(String(42), primary_key=True) # 0x...
    contract_name = Column(String(64), nullable=False)
    chain_id = Column(BigInteger, nullable=False)
    last_processed_block = Column(BigInteger, nullable=False, default=0)
    last_processed_block_hash = Column(String(66), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

# --- Derived Read Model (Blockchain authoritative mirror) ---

class Land(Base):
    __tablename__ = "lands"

    land_id = Column(BigInteger, primary_key=True)
    parcel_key = Column(String(66), unique=True, nullable=False, index=True)
    owner_identity_id = Column(String(66), nullable=False, index=True)
    jurisdiction_id = Column(BigInteger, ForeignKey("jurisdictions.id"), nullable=False, index=True)
    status = Column(String(32), nullable=False) # PENDING_VERIFICATION, VERIFIED, LOCKED_IN_TRANSFER, REJECTED
    geometry_hash = Column(String(66), nullable=False)
    document_manifest_hash = Column(String(66), nullable=False)
    registered_block = Column(BigInteger, nullable=False)
    verified_block = Column(BigInteger, nullable=True)
    verified_by_inspector = Column(String(42), nullable=True)
    active_transfer_id = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

class Escrow(Base):
    __tablename__ = "escrows"

    request_id = Column(BigInteger, primary_key=True)
    land_id = Column(BigInteger, ForeignKey("lands.land_id"), nullable=False, index=True)
    buyer_identity_id = Column(String(66), nullable=False, index=True)
    seller_identity_id = Column(String(66), nullable=False, index=True)
    buyer_wallet = Column(String(42), nullable=True)
    agreed_price = Column(Numeric(36, 18), nullable=False) # In ETH
    deposit_amount = Column(Numeric(36, 18), default=0)
    state = Column(String(32), nullable=False) # REQUESTED, FUNDED, UNDER_REVIEW, APPROVED, COMPLETED, CANCELLED, REJECTED, EXPIRED
    approval_count = Column(Integer, default=0)
    has_senior_approval = Column(Boolean, default=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    funded_at = Column(DateTime(timezone=True), nullable=True)
    settled_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String(255), nullable=True)
    cancellation_reason = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

class BlockchainEvent(Base):
    __tablename__ = "blockchain_events"
    __table_args__ = (
        UniqueConstraint("transaction_hash", "log_index", name="uq_tx_log_index"),
    )

    id = Column(String(36), primary_key=True, default=generate_uuid)
    chain_id = Column(BigInteger, nullable=False)
    contract_address = Column(String(42), nullable=False, index=True)
    block_number = Column(BigInteger, nullable=False, index=True)
    block_hash = Column(String(66), nullable=False)
    transaction_hash = Column(String(66), nullable=False, index=True)
    log_index = Column(Integer, nullable=False)
    event_name = Column(String(100), nullable=False, index=True)
    payload = Column(JSON, nullable=False)
    sync_status = Column(String(20), default="FINALIZED") # UNCONFIRMED, FINALIZED, ORPHANED
    processed_at = Column(DateTime(timezone=True), default=utc_now)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    action = Column(String(100), nullable=False)
    actor_identity_id = Column(String(66), nullable=True, index=True)
    actor_wallet = Column(String(42), nullable=True)
    details = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=utc_now)
