# Backend API Specification (Phase 0 Freeze)

**Framework:** FastAPI (Python 3.11+)  
**Authentication:** EIP-4361 (Sign-In with Ethereum) Nonce Challenge $\rightarrow$ JWT Bearer Token  
**Status:** Frozen v0.1  

---

## 1. Authentication Endpoints (SIWE Handshake)

### `GET /api/v1/auth/nonce`
Generate a cryptographically secure, single-use nonce for wallet signature.
- **Query Params:** `wallet_address: str` (EVM 0x format)
- **Response `200 OK`:**
  ```json
  {
    "nonce": "a8fbc319-74d1-4e9b-b6d2-64112e4fbc89",
    "issued_at": "2026-10-02T13:00:00Z",
    "expires_at": "2026-10-02T13:05:00Z"
  }
  ```

### `POST /api/v1/auth/verify`
Verify MetaMask ECDSA signature over the EIP-4361 challenge message.
- **Request Body:**
  ```json
  {
    "message": "localhost wants you to sign in with your Ethereum account:\n0x1234...\n\nURI: http://localhost:5173\nVersion: 1\nChain ID: 11155111\nNonce: a8fbc319...\nIssued At: 2026-10-02T13:00:00Z",
    "signature": "0xabc123..."
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5c...",
    "token_type": "bearer",
    "user": {
      "identity_id": "0x8f3a12...",
      "wallet_address": "0x1234...",
      "role": "CITIZEN",
      "kyc_status": "VERIFIED"
    }
  }
  ```

---

## 2. Land Application Workflow Endpoints

### `POST /api/v1/applications/draft`
Create an off-chain application draft with spatial boundary and parcel key calculation.
- **Headers:** `Authorization: Bearer <JWT>`
- **Request Body:**
  ```json
  {
    "jurisdiction_id": 101,
    "state": "Maharashtra",
    "district": "Pune",
    "taluka": "Haveli",
    "village": "Kothrud",
    "survey_number": "45",
    "subdivision": "0",
    "geojson": {
      "type": "Polygon",
      "coordinates": [[[73.8567, 18.5201], [73.8580, 18.5210], [73.8591, 18.5198], [73.8574, 18.5189], [73.8567, 18.5201]]]
    }
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "application_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "canonical_identifier": "MH|PUNE|HAVELI|KOTHRUD|45|0",
    "parcel_key": "0x6f31b2...",
    "geometry_hash": "0x91ac34...",
    "area_sq_meters": 1425.50,
    "has_spatial_overlap": false,
    "status": "DRAFT"
  }
  ```

### `POST /api/v1/documents/presigned-upload`
Obtain a secure, direct-to-storage presigned upload URL for legal deeds.
- **Headers:** `Authorization: Bearer <JWT>`
- **Request Body:**
  ```json
  {
    "application_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "document_type": "SALE_DEED",
    "file_name": "SaleDeed_2026.pdf",
    "file_size_bytes": 1048576,
    "mime_type": "application/pdf"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "upload_url": "http://localhost:9000/land-registry-documents/...",
    "expires_in_seconds": 900
  }
  ```

### `POST /api/v1/documents/{document_id}/finalize`
Notify backend that upload is complete; computes constant-memory SHA-256 and rebuilds canonical manifest.
- **Response `200 OK`:**
  ```json
  {
    "document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "sha256_hash": "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "manifest_hash": "0x54b53072540eeeb8f8e9343e71f281ae1cedbc4fe59205da23c04b0a9cad654b",
    "status": "AVAILABLE"
  }
  ```

---

## 3. Read-Model & Dashboard Endpoints (PostgreSQL Powered)

### `GET /api/v1/lands`
Fast, paginated search and filter across all registered lands (no blockchain round-trips).
- **Query Params:** `jurisdiction_id: Optional[int]`, `owner_identity_id: Optional[str]`, `page: int = 1`, `size: int = 20`
- **Response `200 OK`:**
  ```json
  {
    "total": 1420,
    "page": 1,
    "size": 20,
    "items": [
      {
        "land_id": 101,
        "parcel_key": "0x6f31b2...",
        "owner_identity_id": "0x8f3a12...",
        "jurisdiction_id": 101,
        "status": "VERIFIED",
        "geometry_hash": "0x91ac34...",
        "manifest_hash": "0x54b530...",
        "registered_block": 5892100
      }
    ]
  }
  ```

### `GET /api/v1/documents/{document_id}/verify-integrity`
Verify stored document against database and on-chain manifest commitment.
- **Response `200 OK`:**
  ```json
  {
    "document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "INTACT", // or "MISMATCH"
    "stored_sha256": "0xe3b0c4...",
    "on_chain_manifest_verified": true
  }
  ```
