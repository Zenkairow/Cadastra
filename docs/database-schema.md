# Database & Read-Model Specification (Phase 0 Freeze)

**Engine:** PostgreSQL 16  
**Extensions:** `postgis` 3.4, `uuid-ossp`  
**ORM / Migration Tool:** SQLAlchemy 2.0 (async), GeoAlchemy2, Alembic  
**Status:** Frozen v0.1  

---

## 1. Architectural Philosophy: The Derived Read Model
PostgreSQL with PostGIS serves two distinct roles:
1. **Private Application Store:** Off-chain draft land applications, pending document metadata, and KYC verification records.
2. **Blockchain Read Model:** Derived tables mirroring smart contract state (`lands`, `transfers`, `escrows`).
   - Derived tables are populated **exclusively** by the blockchain event indexer (`indexer_user`).
   - Direct manual SQL mutations on derived tables are forbidden and detected by reconciliation.

---

## 2. Database Schema DDL

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. Users & Off-Chain Identity
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identity_id VARCHAR(66) UNIQUE NOT NULL, -- bytes32 hex
    active_wallet VARCHAR(42) UNIQUE,
    role VARCHAR(32) NOT NULL DEFAULT 'CITIZEN', -- CITIZEN, INSPECTOR, SENIOR_INSPECTOR, REGISTRAR, ADMIN
    kyc_status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, VERIFIED, REJECTED
    kyc_reference VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Wallet History & Revocation
CREATE TABLE wallet_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identity_id VARCHAR(66) NOT NULL REFERENCES users(identity_id),
    wallet_address VARCHAR(42) NOT NULL,
    status VARCHAR(20) NOT NULL, -- ACTIVE, REVOKED
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    UNIQUE(identity_id, wallet_address)
);

-- 3. Jurisdictions
CREATE TABLE jurisdictions (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    state VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Land Applications (Off-Chain Drafting)
CREATE TABLE land_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    applicant_identity_id VARCHAR(66) NOT NULL REFERENCES users(identity_id),
    jurisdiction_id BIGINT NOT NULL REFERENCES jurisdictions(id),
    state VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    taluka VARCHAR(50) NOT NULL,
    village VARCHAR(100) NOT NULL,
    survey_number VARCHAR(50) NOT NULL,
    subdivision VARCHAR(50) NOT NULL DEFAULT '0',
    canonical_identifier VARCHAR(255) NOT NULL,
    parcel_key VARCHAR(66) NOT NULL, -- keccak256 hash
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, ON_CHAIN
    has_spatial_overlap BOOLEAN DEFAULT FALSE,
    overlap_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Land Boundaries (PostGIS Geodesic Geometries)
CREATE TABLE land_boundaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES land_applications(id),
    on_chain_land_id BIGINT UNIQUE,
    geometry GEOGRAPHY(POLYGON, 4326) NOT NULL,
    area_sq_meters NUMERIC(12, 2) NOT NULL,
    canonical_geojson JSONB NOT NULL,
    geometry_hash VARCHAR(66) NOT NULL, -- SHA-256
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_land_boundaries_gist ON land_boundaries USING GIST(geometry);

-- 6. Documents (Private MinIO / S3 Metadata)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES land_applications(id),
    on_chain_land_id BIGINT,
    document_type VARCHAR(50) NOT NULL, -- SALE_DEED, 7_12_EXTRACT, TAX_RECEIPT, SURVEY_MAP
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    sha256_hash VARCHAR(66) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE', -- PENDING, AVAILABLE, REPLACED, DELETED
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Document Manifests
CREATE TABLE document_manifests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES land_applications(id),
    on_chain_land_id BIGINT,
    manifest_json JSONB NOT NULL,
    manifest_hash VARCHAR(66) NOT NULL, -- SHA-256
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Authoritative Lands (Blockchain Derived Read-Model)
CREATE TABLE lands (
    land_id BIGINT PRIMARY KEY,
    parcel_key VARCHAR(66) UNIQUE NOT NULL,
    owner_identity_id VARCHAR(66) NOT NULL,
    jurisdiction_id BIGINT NOT NULL REFERENCES jurisdictions(id),
    status VARCHAR(32) NOT NULL,
    geometry_hash VARCHAR(66) NOT NULL,
    document_manifest_hash VARCHAR(66) NOT NULL,
    registered_block BIGINT NOT NULL,
    verified_block BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Transfer Requests & Escrow (Blockchain Derived Read-Model)
CREATE TABLE escrows (
    request_id BIGINT PRIMARY KEY,
    land_id BIGINT NOT NULL REFERENCES lands(land_id),
    buyer_identity_id VARCHAR(66) NOT NULL,
    seller_identity_id VARCHAR(66) NOT NULL,
    agreed_price NUMERIC(36, 18) NOT NULL, -- in ETH
    state VARCHAR(32) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    funded_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Blockchain Event Store (Idempotency Ledger)
CREATE TABLE blockchain_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id BIGINT NOT NULL,
    contract_address VARCHAR(42) NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash VARCHAR(66) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INT NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'UNCONFIRMED', -- UNCONFIRMED, FINALIZED, ORPHANED
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(transaction_hash, log_index)
);
CREATE INDEX idx_events_block ON blockchain_events(block_number);
CREATE INDEX idx_events_tx ON blockchain_events(transaction_hash);

-- 11. Sync State
CREATE TABLE sync_state (
    contract_address VARCHAR(42) PRIMARY KEY,
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    last_finalized_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Database Role Permissions Matrix
| Table | `app_user` (Backend) | `indexer_user` (Indexer) | `readonly_user` (Search/Reporting) |
| :--- | :--- | :--- | :--- |
| `users`, `wallet_bindings` | SELECT, INSERT, UPDATE | SELECT | SELECT |
| `land_applications` | SELECT, INSERT, UPDATE | SELECT | SELECT |
| `land_boundaries` | SELECT, INSERT, UPDATE | SELECT, UPDATE | SELECT |
| `documents`, `document_manifests` | SELECT, INSERT, UPDATE | SELECT | SELECT |
| `lands` (Derived) | **SELECT ONLY** | **SELECT, INSERT, UPDATE** | SELECT |
| `escrows` (Derived) | **SELECT ONLY** | **SELECT, INSERT, UPDATE** | SELECT |
| `blockchain_events` | **SELECT ONLY** | **SELECT, INSERT, UPDATE** | SELECT |
| `sync_state` | **SELECT ONLY** | **SELECT, INSERT, UPDATE** | SELECT |
