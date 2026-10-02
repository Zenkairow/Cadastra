# Future Production Enhancements Backlog

**Project:** Blockchain Land Registry  
**Status:** Archived / Post-Completion Backlog  
**Directive:** As instructed by Project Management, active implementation remains strictly bound to `Blockchain_Land_Registry_Master_Plan.docx`. The enhancements cataloged below are safely archived for consideration *after* the primary project baseline is fully delivered, tested, and demonstrated.

---

## Overview

During the Phase 3 pause and deep architectural review of the master plan, the engineering team synthesized 28 production-grade enhancements to bridge the baseline prototype to a commercial, government-scale deployment. 

These items are deliberately kept out of the active critical path to eliminate scope creep and preserve predictable phase completion.

---

## Domain 1: Smart Contracts & Protocol Layer

1. **Government Stamp Duty & Registration Tax Deduction in Escrow:**
   - In real real-estate legal transactions, government revenue offices collect stamp duty (e.g. 5%) and registration fees (e.g. 1%).
   - *Proposal:* Add configurable treasury basis points in `TransferEscrow.sol` so settlement atomically routes:
     - `Treasury Amount = Price * StampDutyBps / 10000`
     - `Seller Amount = Price - Treasury Amount`
2. **ERC-165 Interface Standardization:**
   - Implement `IERC165` across all 4 contracts (`IIdentityRegistry`, `IInspectorRegistry`, `ILandRegistry`, `ITransferEscrow`) for standardized programmatic discovery by third-party dApps and court registries.
3. **Storage Packing & Gas Optimization:**
   - Optimize struct layout to pack storage into minimal 32-byte slots (e.g., combining `uint8 level`, `bool active`, `uint64 validUntil`, `uint128 jurisdictionId`).
4. **Custom Error Standardization:**
   - Ensure custom errors provide descriptive diagnostic parameters (e.g. `UnauthorizedInspector(address caller, uint256 expectedJurisdiction, uint256 actualJurisdiction)`).
5. **Multi-Sig & Timelock Administration:**
   - Introduce an OpenZeppelin `TimelockController` or Gnosis Safe multi-sig for the Level 0 System Admin role to eliminate single-key administrative compromise risks.

---

## Domain 2: Geospatial & Boundary Validation (PostGIS Engine)

6. **Dual Coordinate System Standardization (WGS 84 vs. Projected UTM):**
   - Store input/output in `EPSG:4326` (WGS 84 lat/lng) for web mapping compatibility.
   - Perform sub-centimeter intersection and area queries in projected coordinate systems (e.g. `EPSG:32643` UTM Zone 43N or PostGIS `geography` type).
7. **Cadastral Boundary Snapping & Sliver Tolerance:**
   - Define a buffer tolerance ($\epsilon = 0.05\text{ m}^2$ or 0.05% of parcel area) to distinguish valid shared fence lines (`SHARED_BOUNDARY`) from true illegal encroachments (`CRITICAL_OVERLAP`).
8. **Topological Validation Rules:**
   - Validate GeoJSON topology before ingestion: `ST_IsValid` (no self-intersecting bow-tie polygons), `ST_IsSimple`, minimum 4 vertices ($P_1 \equiv P_n$), 6-decimal precision clamping.
9. **RFC 7946 & RFC 8785 Canonical Geometry Hashing:**
   - Guarantee identical plots yield the exact same `geometryHash`: enforce counter-clockwise exterior ring order, index-0 start vertex with minimum latitude/longitude, and RFC 8785 (JSON Canonicalization Scheme) before SHA-256 hashing.

---

## Domain 3: Security & Zero-Trust Authentication

10. **Full EIP-4361 (Sign-In with Ethereum) Compliance:**
    - Strict SIWE formatting: domain/origin binding, single-use random nonces with 5-minute TTL stored in Redis, Sepolia Chain ID (`11155111`) verification, and instant nonce invalidation.
11. **Production-Ready KYC Provider Interface:**
    - Pluggable KYC strategy pattern:
      - `MockKYCAdapter`: For local development and demonstrations.
      - `DigiLockerKYCAdapter`: Production stub for India's DigiLocker API / UIDAI Offline Paperless e-KYC.
12. **Anti-Sybil & API Rate Limiting:**
    - Redis-backed token bucket rate limiting on public endpoints (`/auth/nonce`, `/applications/draft`) capping requests to 10 req/min per IP.

---

## Domain 4: Event Indexer & Database Read-Model

13. **Two-Tier Block Finality Architecture:**
    - *Tier 1 (Soft Confirmation — Depth 2 Blocks / ~24s):* Fast UI display with `sync_status = 'UNCONFIRMED'`.
    - *Tier 2 (Hard Finality — Depth 32 Blocks or Sepolia `finalized` tag):* Promoted to `sync_status = 'FINALIZED'`.
14. **Chain Reorganization (Reorg) Rollback Engine:**
    - Store `block_hash` in `blockchain_events`. On detecting a chain reorganization, roll back mutations on derived tables (`lands`, `transfers`, `escrows`) down to the common ancestor block using SQL savepoints.
15. **Reconciliation Daemon with Prometheus Alerting:**
    - Background task running every 30 minutes, auditing Sepolia state against PostgreSQL. Logs `SYNC_ERROR` and emits alert metrics on divergence.
16. **PostgreSQL Row-Level Security (RLS) & Granular Roles:**
    - Enforce database-level permissions: `app_user` restricted to `SELECT` on derived tables; `indexer_user` exclusive `INSERT`/`UPDATE` access.

---

## Domain 5: Document Pipeline & Private Object Storage

17. **Direct-to-Storage Presigned S3 Multipart Uploads:**
    - Browser streams large orthophoto/survey packages directly into MinIO/S3 using multipart upload URLs, preventing web server memory exhaustion.
18. **Constant-Memory Streaming SHA-256 Calculation:**
    - Stream files in 64KB buffers directly from storage, guaranteeing $O(1)$ RAM usage for files up to multi-gigabyte survey bundles.
19. **Anti-Malware & Magic-Byte MIME Verification:**
    - Inspect magic bytes (e.g. `%PDF-`, `II*\0`) and scan files with a ClamAV container before marking documents `AVAILABLE`.
20. **Canonical Document Manifest Scheme (RFC 8785):**
    - Deterministic JSON serialization (alphabetically sorted keys, stripped whitespace, UTF-8 encoded) before hashing into `manifestHash`.

---

## Domain 6: Enterprise Frontend & Visualization

21. **Four Dedicated Role Portals:**
    - Citizen/Landowner Portal (Application wizard, boundary upload/drawing, document upload).
    - Buyer Portal (Interactive map search, ownership provenance timeline, escrow modal).
    - Field/Senior Inspector Portal (Jurisdiction queue, CAD boundary overlay, document integrity checker).
    - Registrar/Admin Portal (Inspector appointment roster, system lag monitor, audit log search).
22. **Terra Draw Cadastral Map Integration:**
    - Snapping to existing parcel corners, real-time geodesic area readout (sq. meters, acres, hectares), and color-coded conflict overlays.
23. **Interactive Escrow Transaction Stepper:**
    - Visual progress bar tracking: `Requested` $\rightarrow$ `Funded` $\rightarrow$ `Under Review` $\rightarrow$ `Approved` $\rightarrow$ `Settled` with Sepolia Etherscan links.

---

## Domain 7: DevOps, Observability & Production SRE

24. **Reverse Proxy & Production Ingress:**
    - Nginx / Traefik container with SSL/TLS termination, HTTP/2, Gzip/Brotli compression, and security headers (HSTS, CSP, X-Frame-Options).
25. **Database Connection Pooling (PgBouncer / Async SQLAlchemy):**
    - High concurrency management with connection pooling (max 50 persistent connections).
26. **Observability Stack (Prometheus + Grafana + Loki):**
    - Metrics for `indexer_block_lag`, `escrow_total_locked_eth`, `api_response_time_ms`, and `reconciliation_sync_errors_total`.
27. **Automated Slither & Static Analysis in CI:**
    - Continuous static analysis gate in GitHub Actions.
28. **Testnet Gas & Faucet Management Automation:**
    - Alerting script notifying when Sepolia test ETH drops below threshold.
