# Technical Whitepaper: Blockchain Land Registry

A hierarchical, identity-bound, escrow-secured land registry with geospatial validation, tamper-evident documents, and event-driven synchronization.

---

## 1. Project Abstract / Problem
Traditional land registration systems suffer from opaque record-keeping, single points of failure, administrative corruption, boundary fraud, double-selling of parcels, and sluggish paper workflows. Early blockchain-based prototypes typically reduce the problem to a single monolithic smart contract accompanied by a basic React frontend. However, toy implementations fail to address fundamental real-world constraints:
- They store raw identity or unverified claims publicly on-chain.
- They lack geographical boundary checking, allowing fictitious or overlapping land parcels to be registered.
- They fail to isolate payment and ownership settlement, risking double-spending or seller fraud.
- They rely on inefficient sequential on-chain reads for user dashboards, which cannot scale.

This project delivers an enterprise-grade, auditable, multi-tier land governance platform. It harmonizes on-chain cryptographic finality with off-chain privacy and geospatial analysis, anchored by an event-driven derived read model on the Ethereum Sepolia testnet.

---

## 2. Objectives
1. **Authoritative On-Chain State:** Secure land title and ownership transitions via immutable smart contracts with deterministic state machines.
2. **Identity & Wallet Binding:** Guarantee a strict 1-to-1 mapping between a verified platform identity and an active wallet without exposing sensitive KYC data on-chain.
3. **Hierarchical Inspector Governance:** Replace single-admin vulnerability with a multi-tier, jurisdiction-bounded inspector network supporting threshold approvals for high-value operations.
4. **Three-Tier Duplicate Prevention:** Detect parcel fraud at three distinct layers: exact parcel key hash on-chain, PostGIS spatial overlap off-chain, and inspector-verified document cross-checks.
5. **Private, Tamper-Evident Document Management:** Store large deeds and survey bundles in private object storage, anchoring immutable canonical manifest hashes on-chain.
6. **Escrow-Secured Settlement:** Safeguard buyer funds in a dedicated financial escrow contract with exact-payment enforcement, deadlines, refunds, and atomic ownership settlement.
7. **Idempotent Synchronization:** Maintain a queryable PostgreSQL/PostGIS read model fed strictly by blockchain events, resilient to node crashes, reorgs, and out-of-order logs.
8. **Empirical Evaluation:** Validate every architecture claim through reproducible benchmarks (gas metrics, read scalability, tampering detection, and authorization matrices).

---

## 3. Current Architecture
```
+-------------------------------------------------------------------------+
|                           PRESENTATION LAYER                            |
|     React (Vite) + Ethers.js + Material UI + Google Maps / Terra Draw   |
+--------------------+-------------------------------+--------------------+
                     |                               |
          Signed Transactions               REST API / JWT / SIWE
                     |                               |
                     v                               v
+-------------------------------------+   +-------------------------------+
|          BLOCKCHAIN LAYER           |   |       APPLICATION LAYER       |
|          (Ethereum Sepolia)         |   |     FastAPI (Python 3.11+)    |
|                                     |   | - Wallet Auth (EIP-4361)      |
| [IdentityRegistry]                  |   | - Mock KYC Adapter            |
|       ^                             |   | - Document Upload & Hasher    |
|       | verifies                    |   | - Canonical GeoJSON Normalizer|
| [InspectorRegistry]                 |   +---------------+---------------+
|       ^                             |                   |
|       | authorizes                  |             SQLAlchemy /
| [LandRegistry] <---> [TransferEscrow]             GeoAlchemy2
|       |                      |                          |
+-------+----------------------+------+                   v
        | Emits Events         | Emits Events +---------------------------+
        +------------+---------+              |        DATA LAYER         |
                     |                        | PostgreSQL 16 + PostGIS   |
                     v                        | - Derived Read Model      |
        +-------------------------+           | - Land Applications       |
        |    INTEGRATION LAYER    | Writes    | - Spatial Index (GIST)    |
        |   Event Indexer Worker  |---------->|                           |
        |   (Confirmation-Aware)  |           | MinIO / S3 Object Storage |
        +-------------------------+           | - Private Document Blobs  |
                                              +---------------------------+
```

---

## 4. Technology Stack
- **Smart Contracts:** Solidity `^0.8.24`, OpenZeppelin Contracts v5, Hardhat.
- **Target Network:** Ethereum Sepolia Testnet (Chain ID `11155111`).
- **Backend API:** Python 3.11+, FastAPI, Pydantic v2, SQLAlchemy 2.0.
- **Database & Spatial Engine:** PostgreSQL 16, PostGIS 3.4 (`GIST` indexing, WGS 84 / `EPSG:4326` & projected area calculations).
- **Document & Blob Storage:** MinIO (Local Dev), AWS S3 / Azure Blob compatible (Staging/Production).
- **Frontend Client:** React 18, Vite, Ethers.js v6, Material UI (MUI v5), Google Maps JavaScript API (using editable `google.maps.Polygon` / Terra Draw).
- **Security & Quality:** Slither (Static Analysis), Echidna/Foundry (Fuzzing/Invariants), Ruff, Prettier, Solhint.

---

## 5. System Components
1. **`IdentityRegistry.sol` [IMPLEMENTED]:** Manages verified platform identities (`bytes32 identityId`) and active wallet bindings. Provides wallet activation, revocation, and loss recovery mechanics.
2. **`InspectorRegistry.sol` [IMPLEMENTED]:** Manages inspector hierarchy (Levels 0–3), jurisdiction assignments (`jurisdictionId`), terms of appointment (`validUntil`), and multi-tier authorization checks.
3. **`LandRegistry.sol` [IMPLEMENTED]:** Authoritative record of registered parcels, canonical parcel keys (`parcelKey`), ownership (`ownerIdentityId`), geometry commitments (`geometryHash`), and document manifest commitments (`documentManifestHash`).
4. **`TransferEscrow.sol` [IMPLEMENTED]:** Financial custodian for land acquisitions. Enforces exact escrow deposits, multi-inspector approvals, atomic settlement, and pull-payment refunds and proceeds.
5. **FastAPI Application Server [PLANNED]:** Orchestrates off-chain workflows (draft applications, presigned uploads, KYC adapter, spatial overlap checks, read-model queries).
6. **Blockchain Event Indexer [PLANNED]:** Background worker tracking finalized blocks from Sepolia, persisting logs to `blockchain_events` idempotently, and projecting state onto derived tables.
7. **Spatial Engine (PostGIS) [PLANNED]:** Computes geodesically accurate polygon areas and evaluates intersections against existing boundaries.
8. **Object Storage Service [PLANNED]:** Secure, private storage for deeds, extracts, and survey bundles with streaming SHA-256 calculation.
9. **Reconciliation Daemon [PLANNED]:** Periodic auditor comparing on-chain state with derived read-model tables, flagging and self-healing divergences.

---

## 6. Trust Boundaries
- **Public / Untrusted:** Web browsers, mobile devices, client-side input parameters, unauthenticated network traffic.
- **Client Identity Boundary:** Ethereum private keys held exclusively in MetaMask; client signs challenges (SIWE) and transactions. The backend never receives or stores private keys.
- **Off-chain vs On-chain Trust Boundary:** The smart contracts trust only explicit cryptographic signatures and valid authorized transactions; they do not trust database state.
- **Application vs Database Trust Boundary:** Backend connects as `app_user` (cannot alter blockchain-derived tables). Only `indexer_user` can mutate derived tables.
- **Identity & KYC Boundary:** Aadhaar and government PII remain isolated outside the system. The platform interacts exclusively with an opaque KYC adapter returning pseudonymous verification tokens.

---

## 7. On-chain / Off-chain Responsibilities
| Data / Operation | On-Chain (Sepolia) | Off-Chain (PostgreSQL / MinIO) |
| :--- | :--- | :--- |
| **Land ID & Parcel Key** | Primary Source of Truth (`keccak256`) | Indexed Read-Model Copy |
| **Current Land Owner** | Primary Source of Truth (`address`) | Derived Read-Model Copy |
| **Land Status** | Authoritative State Machine | Mirrored Copy |
| **Payment Escrow Funds** | Held in Contract Balance (`msg.value`) | Not Held (Metadata only) |
| **Ownership History** | Immutable Event Logs | Materialized Table via Indexer |
| **Cadastral Polygon Geometry** | SHA-256 Commitment (`geometryHash`)| WGS 84 Polygon in PostGIS |
| **Deeds & Legal Documents** | SHA-256 Manifest Commitment (`manifestHash`)| Private Blobs in MinIO / S3 |
| **PII & Aadhaar Details** | Never Stored / Never Hashed | Isolated in Mock KYC Adapter |
| **Search & Pagination** | Never Executed | Fast Indexed SQL Queries |

---

## 8. Identity & Wallet Authentication
- **Binding Invariant [IMPLEMENTED]:** Exactly one active wallet address per verified identity UUID (`bytes32`), and exactly one identity per wallet. Enforced on-chain by `IdentityRegistry.sol`.
- **Wallet Loss & Recovery [IMPLEMENTED]:** If a private key is compromised or lost, the user completes re-verification via the KYC adapter. The old wallet is transitioned to `REVOKED` in `IdentityRegistry.sol`, and the new wallet is registered as `ACTIVE`. Revoked wallets are permanently barred from submitting transactions.
- **Authentication Handshake [PLANNED]:**
  1. Frontend requests a cryptographic challenge (EIP-4361 SIWE nonce) from FastAPI.
  2. MetaMask signs the challenge message.
  3. FastAPI validates the ECDSA signature, domain, timestamp, and chain ID (`11155111`).
  4. Backend issues a scoped, short-lived JWT token encoding identity, active wallet, and role.
- **Zero On-Chain PII Policy [IMPLEMENTED]:** Aadhaar numbers, biometric data, or identity documents are never placed on-chain. Even hashing raw Aadhaar numbers onto the blockchain is strictly prohibited to prevent rainbow-table correlation.

---

## 9. Inspector Governance
- **Role Hierarchy [IMPLEMENTED]:**
  - **Level 0 (System Administrator):** Appoints/revokes Regional Registrars, updates contract configuration via two-step ownership transfer.
  - **Level 1 (Regional Registrar):** Manages Senior Inspectors and Inspectors strictly within their assigned `jurisdictionId`.
  - **Level 2 (Senior Inspector):** Grants secondary approvals for high-value transactions, cross-border appeals, and dispute reviews.
  - **Level 3 (Field Inspector):** Performs physical survey inspection, boundary verification, and primary application sign-off.
- **Jurisdiction Containment [IMPLEMENTED]:** Every land parcel is minted with an explicit `jurisdictionId`. Smart contract calls revert unless:
  `inspector.jurisdictionId == land.jurisdictionId && inspector.active && block.timestamp <= inspector.validUntil`
- **Threshold Approvals [PLANNED]:** Critical transfers or high-value classifications require $M$-of-$N$ inspector confirmations (e.g., Inspector Level 3 + Senior Inspector Level 2).

---

## 10. Land Registration Lifecycle
1. **Drafting (Off-Chain):** KYC-verified applicant submits parcel metadata (State, District, Taluka, Survey Number) and GeoJSON polygon via the frontend.
2. **Deterministic Pre-checks:**
   - Backend normalizes metadata into a canonical string and checks `parcelKey` against existing records.
   - PostGIS executes spatial intersection queries (`ST_Intersects`, `ST_Intersection`) against all registered parcels.
   - Files are uploaded to MinIO via presigned URLs; backend calculates individual SHA-256 hashes and builds the canonical document manifest.
3. **Application Review (Off-Chain):** If pre-checks pass, a `land_applications` record is created. Field inspector in matching jurisdiction inspects survey boundaries, documents, and duplicate flags.
4. **On-Chain Minting (`registerLand`) [IMPLEMENTED]:** Upon inspector sign-off, the authorized inspector triggers on-chain registration. `LandRegistry.sol` verifies uniqueness of `parcelKey`, stores `geometryHash` and `documentManifestHash`, verifies owner active wallet in `IdentityRegistry`, and emits `LandRegistered`.
5. **Inspector Verification (`verifyLand`) [IMPLEMENTED]:** Inspector verifies parcel on-chain with jurisdiction check, updating status to `VERIFIED` and emitting `LandVerified`.
6. **Read-Model Ingestion [PLANNED]:** The indexer captures `LandRegistered` and `LandVerified`, updating PostgreSQL.

---

## 11. Duplicate / Spatial Validation
- **Layer 1: Exact Parcel Identifier (Blockchain Enforced) [IMPLEMENTED]:**
  $$\text{canonicalIdentifier} = \text{State} \parallel \text{"\|"} \parallel \text{District} \parallel \text{"\|"} \parallel \text{Taluka} \parallel \text{"\|"} \parallel \text{Village} \parallel \text{"\|"} \parallel \text{SurveyNo} \parallel \text{"\|"} \parallel \text{Subdivision}$$
  $$\text{parcelKey} = \text{keccak256}(\text{canonicalIdentifier})$$
  `LandRegistry.sol` checks `require(!_parcelExists[parcelKey])` and reverts with `DuplicateParcelKey(parcelKey)`.
- **Layer 2: Spatial Overlap Detection (PostGIS Enforced) [PLANNED]:**
  Polygons are indexed using PostGIS `GIST`. When a new boundary is proposed:
  ```sql
  SELECT id, ST_Area(ST_Intersection(b.geometry, ST_GeomFromGeoJSON(:new_geom)::geography)) AS overlap_area
  FROM land_boundaries b
  WHERE ST_Intersects(b.geometry, ST_GeomFromGeoJSON(:new_geom));
  ```
  Any overlap greater than threshold flags the application with severity ratings (Exact Match, Encroachment, Neighbor Edge Contact).
- **Layer 3: Cross-Check Inspection [PLANNED]:**
  Inspector compares satellite boundary against municipal cadastral survey maps and flags discrepancies before approval.

---

## 12. Document Integrity [IMPLEMENTED]
- **Storage Pipeline (`backend/app/services/storage_service.py`) [IMPLEMENTED]:**
  - Files are streamed into S3/MinIO (with fallback local driver) in chunked constant-memory streams ($O(1)$ memory buffer, `chunk_size=65536`).
  - Binary magic-byte inspection (`backend/app/services/document_security.py`) validates actual file headers (`%PDF-`, PNG, JPEG, TIFF, ZIP) and prevents extension/MIME-type spoofing.
  - Per-class size enforcement rejects oversized payloads (Scanned Deeds: 25 MB, Survey Maps: 100 MB, GIS bundles: 500 MB).
- **Manifest Architecture (`backend/app/services/manifest_service.py`) [IMPLEMENTED]:**
  Multiple documents (`SALE_DEED`, `7_12_EXTRACT`, `TAX_RECEIPT`, `SURVEY_MAP`, `GIS_PACKAGE`) are assembled into a canonical, alphabetically sorted JSON manifest without whitespace:
  ```json
  [
    {"doc_id":"DOC-1","doc_type":"SALE_DEED","file_name":"deed.pdf","sha256":"0x...","version":1},
    {"doc_id":"DOC-2","doc_type":"TAX_RECEIPT","file_name":"tax.pdf","sha256":"0x...","version":1}
  ]
  ```
  `manifestHash = "0x" + sha256(canonical_manifest_json)`. Only `manifestHash` is anchored on-chain in `LandRegistry.sol`.
- **Tamper Verification (`backend/app/services/tamper_service.py`) [IMPLEMENTED]:**
  Endpoint `/api/v1/documents/verify/{application_id}` re-streams stored binary files from object storage, recalculates SHA-256 hashes in constant memory, rebuilds the canonical manifest, and validates against database commitments and the on-chain `documentManifestHash`.
  - Accurately detects and isolates: 1-byte flips, metadata changes, file truncations, and complete file replacements down to the specific corrupted document ID.
- **Secure Download & Access Audits (`backend/app/api/v1/documents.py`) [IMPLEMENTED]:**
  Short-lived presigned URLs (900 seconds) are issued strictly to property applicants and authorized inspectors. Every document download emits a structured `DOCUMENT_ACCESSED` entry in `audit_logs`.

---

## 13. Smart Contract Architecture
Four decoupled, specialized contracts deployed on Sepolia:
1. **`IdentityRegistry.sol`:**
   - State: `mapping(bytes32 => address) identityToWallet`, `mapping(address => bytes32) walletToIdentity`, `mapping(address => bool) activeWallets`.
   - Methods: `verifyIdentity()`, `activateWallet()`, `revokeWallet()`, `isVerified()`.
2. **`InspectorRegistry.sol`:**
   - State: `mapping(address => Inspector) inspectors`.
   - Methods: `addInspector()`, `revokeInspector()`, `changeLevel()`, `assignJurisdiction()`, `isAuthorized()`.
3. **`LandRegistry.sol`:**
   - State: `mapping(bytes32 => Land) lands`, `mapping(bytes32 => bool) parcelExists`.
   - Modifiers: `onlyAuthorizedInspector(jurisdictionId, minLevel)`.
   - Methods: `registerLand()`, `verifyLand()`, `transferOwnership()`.
4. **`TransferEscrow.sol`:**
   - State: `mapping(uint256 => EscrowRequest) requests`.
   - Methods: `requestTransfer()`, `fundEscrow()`, `approveTransfer()`, `settleTransfer()`, `cancelRequest()`, `refundBuyer()`.

---

## 14. Escrow / Transfer State Machine [IMPLEMENTED]
```
       +-------------+
       |  REQUESTED  | <---+ (Buyer initiates request)
       +------+------+
              |
              | buyer funds exact msg.value
              v
       +-------------+
       |   FUNDED    |
       +------+------+
              |
              +--------------------------+-----------------------+
              |                          |                       |
              | inspector review         | buyer cancels         | deadline passes
              v                          v                       v
       +-------------+            +-------------+         +-------------+
       |  APPROVED   |            |  CANCELLED  |         |   EXPIRED   |
       +------+------+            +------+------+         +------+------+
              |                          |                       |
              | settleTransfer()         | pull refund           | pull refund
              v                          v                       v
       +-------------+            +-------------+         +-------------+
       |  COMPLETED  |            |  REFUNDED   | <-------+  REFUNDED   |
       +-------------+            +-------------+         +-------------+
       (Settlement atomic:
        Funds -> Seller,
        Title -> Buyer)
```
- **Exact-Payment Constraint [IMPLEMENTED]:** `require(msg.value == request.agreedPrice, "Incorrect deposit")`.
- **Atomic Settlement [IMPLEMENTED]:** Title transfer in `LandRegistry` and fund release in `TransferEscrow` occur within the same transaction execution context.
- **Pull-Over-Push Payments [IMPLEMENTED]:** Refunds and seller disbursements follow the OpenZeppelin pull-payment pattern (`withdrawFunds()`) to prevent reentrancy and denial-of-service from reverting recipient contracts.
- **High-Value Governance [IMPLEMENTED]:** Transfers where `agreedPrice >= 5 ETH` require at least two approvals, including a Senior Inspector (Level 2).

---

## 15. Blockchain Event Flow
The contracts emit deterministic events that serve as the sole trigger for read-model mutations:
1. `LandRegistered(uint256 indexed landId, bytes32 indexed parcelKey, address indexed owner, uint256 jurisdictionId, bytes32 geometryHash, bytes32 manifestHash)`
2. `LandVerified(uint256 indexed landId, address indexed inspector)`
3. `TransferRequested(uint256 indexed requestId, uint256 indexed landId, address indexed buyer, address seller, uint256 price)`
4. `EscrowFunded(uint256 indexed requestId, address indexed buyer, uint256 amount)`
5. `TransferApproved(uint256 indexed requestId, address indexed inspector, uint8 inspectorLevel)`
6. `OwnershipTransferred(uint256 indexed landId, address indexed previousOwner, address indexed newOwner)`
7. `EscrowReleased(uint256 indexed requestId, address indexed seller, uint256 amount)`
8. `RefundIssued(uint256 indexed requestId, address indexed buyer, uint256 amount)`

---

## 16. Indexer + PostgreSQL/PostGIS Read Model [IMPLEMENTED]
- **Idempotency Guarantee [IMPLEMENTED]:**
  `blockchain_events` table enforces relational uniqueness via:
  `UNIQUE(transaction_hash, log_index)`.
  In `indexer/service.py`, each event is processed in a single atomic database transaction: the event row is inserted into `blockchain_events` and immediately projected onto derived tables (`lands`, `escrows`, `inspectors`, `users`, `wallet_bindings`). Duplicate log ingestion is detected and safely skipped with zero side effects.
- **Reorg Resilience & Confirmation Boundaries [IMPLEMENTED]:**
  The indexer only ingests blocks up to `latest_block - confirmation_depth` (default 1 for local testing, 6 for Sepolia). During sync, it checks whether `parent_block_hash` matches `last_processed_block_hash`. If a chain reorg is detected, events from the divergent fork are marked `ORPHANED` and the sync state rewinds to the canonical ancestor block.
- **Domain Event Handlers [IMPLEMENTED]:**
  Modular handlers in `indexer/handlers/` decode and materialize events for:
  - `IdentityRegistry`: `IdentityBound`, `WalletRecovered`, `WalletRevoked`.
  - `InspectorRegistry`: `InspectorAdded`, `InspectorRevoked`, `InspectorLevelChanged`, `InspectorJurisdictionChanged`.
  - `LandRegistry`: `LandRegistered`, `LandVerified`, `LandRejected`, `LandLockedForTransfer`, `LandUnlockedFromTransfer`, `OwnershipTransferred`.
  - `TransferEscrow`: `TransferRequested`, `EscrowFunded`, `TransferUnderReview`, `TransferApproved`, `TransferCompleted`, `TransferCancelled`, `TransferRejected`, `TransferExpired`, `TransferRefunded`, `FundsWithdrawn`.
- **Self-Healing Reconciliation Engine [IMPLEMENTED]:**
  `indexer/reconciliation.py` performs scheduled or on-demand audits comparing PostgreSQL read-model entities with direct smart contract RPC calls (`getLand()`, `getRequest()`). If an unauthorized database mutation occurs, the reconciliation engine logs `SYNC_ERROR_DETECTED` in `audit_logs`, overwrites the corrupted record with on-chain ground truth, and logs `SYNC_ERROR_REPAIRED`.
- **Operational CLI [IMPLEMENTED]:**
  `indexer/cli.py` provides administrative commands: `run` (daemon), `backfill --from-block <N> --to-block <M>`, `reconcile` (audit & heal), and `status` (lag metrics).

---

## 17. Frontend ↔ Backend ↔ Blockchain Flow
```
[ MetaMask ] -- (1) SIWE Challenge ---------------------> [ FastAPI ]
[          ] <-- (2) Signed Challenge Nonce -------------- [         ]
[          ]                                               [         ]
[          ] -- (3) Upload Docs + GeoJSON ---------------> [         ]
[          ]                                               [         ] -> MinIO & PostGIS
[          ] <-- (4) Validated Hashes & Pre-checks ------- [         ]
[          ]                                               [         ]
[          ] -- (5) Sign & Send TX (Sepolia) --------+     [         ]
                                                     |     [         ]
                                                     v     [         ]
                                            [ Smart Contracts ]      |
                                                     |               |
                                              (6) Emits Event        |
                                                     v               |
                                              [ Indexer Worker ]     |
                                                     |               |
                                              (7) Writes DB          v
                                                     +--------> [ PostgreSQL ]
                                                                     ^
[ Frontend UI ] <--- (8) Fast Read Queries / Filtered Search --------+
```

---

## 18. Security Model
- **Reentrancy Protection:** All financial functions implement OpenZeppelin `ReentrancyGuard`.
- **Access Control:** Role-Based Access Control (RBAC) via `AccessControlEnumerable` and custom jurisdiction-level modifiers.
- **Checks-Effects-Interactions:** State transitions are finalized before any external ETH transfer.
- **Strict Parameter Normalization:** Textual cadastral identifiers are canonicalized prior to hashing to eliminate whitespace/casing collision attacks.
- **Sanitization & OWASP Compliance:** Multipart file uploads strictly enforce byte signature validation, size caps, and antivirus scanning.

---

## 19. Failure / Recovery / Reconciliation
- **Reconciliation Engine [PLANNED]:** A scheduled cron task polls on-chain state for a batch of parcels and compares:
  `Contract.getLand(id).owner == PostgreSQL.lands.owner`
  `Contract.getEscrow(id).state == PostgreSQL.escrows.state`
  If a divergence is detected, an alert `SYNC_ERROR` is logged, and the state is rebuilt using `rebuild_from_events(land_id)`.
- **Indexer Crash Recovery [PLANNED]:** The indexer resumes from `sync_state.last_processed_block` with zero duplicate execution.

---

## 20. Deployment Architecture
- **Local Dev:** Docker Compose hosting PostgreSQL 16 + PostGIS 3.4, MinIO S3 object store, and a local Hardhat node.
- **Testnet Target:** Ethereum Sepolia (`11155111`).
- **RPC Layer:** Alchemy / Infura Sepolia endpoints with automatic fallback.
- **Explorer Verification:** Etherscan Sepolia source-code verification via Hardhat verify plugin.

---

## 21. Testing Strategy
- **Unit & Negative Tests:** 100% branch and function coverage for all revert conditions in Solidity contracts.
- **Escrow Invariant Fuzzing:** Automated randomized action sequences verifying that:
  $$\text{Escrow.balance} \equiv \sum \text{Funded Unsettled Requests}$$
- **API Tests:** Pytest suite testing all endpoints, authentication permutations, and database role restrictions.
- **End-to-End Testing:** Automated Playwright browser tests verifying wallet connection, land registration, and escrow settlement.

---

## 22. Performance / Evaluation Methodology
The project will execute 6 empirical research experiments:
- **RQ1 (Inspector Hierarchy):** Authorization matrices across active, revoked, expired, and wrong-region inspectors.
- **RQ2 (Duplicate Detection):** Synthetic benchmark injecting 100 exact duplicate keys and 50 spatial overlaps across 1,000 parcels.
- **RQ3 (Escrow Security):** Execution of test cases TC01–TC10 (underpayment, double release, unauthorized refund, expired requests).
- **RQ4 (Event Synchronization):** Benchmarking latency, throughput, and self-healing reconciliation under injected database tampering.
- **RQ5 (Document Integrity):** Tamper detection across 100 files with 4 corruption profiles (1-byte flip, metadata change, page deletion, complete replacement).
- **RQ6 (Read Scalability):** Comparing dashboard load times: Direct RPC reads vs PostgreSQL indexed queries at $N \in \{10, 50, 100, 500, 1000, 5000\}$ parcels.

---

## 23. Current Limitations
- Prototype uses mock KYC adapter rather than live UIDAI/Aadhaar CIDR API (due to statutory sandbox restrictions).
- Contracts are immutable for this academic version; upgradeable proxy patterns are deferred to future production versions.
- Sepolia block times (~12 seconds) introduce latency for on-chain state confirmations compared to high-throughput L2s.

---

## 24. Open Decisions
1. **Decision 0.1:** Should `UNDER_REVIEW` be an independent state in `TransferEscrow.sol`, or can it remain part of `FUNDED`?
2. **Decision 0.2:** Should transfer coordination logic live in a dedicated `TransferManager.sol` or directly inside `LandRegistry.sol`?
3. **Decision 0.3:** Threshold criteria for multi-inspector / senior inspector approval (e.g. price threshold vs agricultural classification).
4. **Decision 0.4:** Should land applications emit an on-chain event (`LandApplicationCreated`) or remain purely off-chain in PostgreSQL until approved?

---

## 25. Phase Status (Aligned with Master Plan: Blockchain_Land_Registry_Master_Plan.docx)
- **Phase 0 — Foundations & Architecture Freeze:** `[COMPLETED]`
- **Phase 1 — Identity & Inspector Governance Contracts:** `[COMPLETED]`
- **Phase 2 — Land Registry Core & Duplicate Prevention:** `[COMPLETED]`
- **Phase 3 — Escrow, Transfers & Contract Completion (Milestone M2):** `[COMPLETED]`
- **Phase 4 — Backend Foundation: API, Database & Authentication:** `[COMPLETED]`
- **Phase 5 — Event Indexer & Read Model:** `[COMPLETED]`
- **Phase 6 — Documents & Large-File Storage:** `[COMPLETED]`
- **Phase 7 — Geospatial Validation & Maps:** `[PLANNED]`
- **Phase 8 — Frontend & End-to-End Integration (Milestone M4):** `[PLANNED]`
- **Phase 9 — Security Hardening & Verification (Milestone M5):** `[PLANNED]`
- **Phase 10 — Performance Measurement & Research Experiments:** `[PLANNED]`
- **Phase 11 — Release, Documentation & Research Paper (Milestone M6):** `[PLANNED]`

---

## 26. Change Log
- **2026-10-02 (Phase 0 Baseline):** Initial whitepaper created from the consolidated Master Plan (`Blockchain_Land_Registry_Master_Plan.docx`). Established 4-contract architecture, Sepolia testnet baseline, removed ML scope, defined 4 kinds of truth, and codified the 12-phase engineering roadmap.
- **2026-10-02 (Phase 0 Freeze):** Monorepo structure scaffolded (`contracts/`, `backend/`, `indexer/`, `frontend/`, `infra/`, `docs/`, `scripts/`, `deployments/`). All 6 foundational specification documents frozen: `architecture.md`, `contract-spec.md`, `database-schema.md`, `api-spec.md`, `security-model.md`, `test-plan.md`. Local infrastructure configured via `docker-compose.yml` (PostGIS 3.4 + MinIO) and environment template `.env.example`. Phase 0 marked complete.
- **2026-10-02 (Phase 1 Identity & Inspector Governance):** Implemented `IdentityRegistry.sol` (1 verified identity $\leftrightarrow$ 1 active wallet invariant, wallet recovery, zero-PII storage) and `InspectorRegistry.sol` (4-tier hierarchy, jurisdiction containment, appointment terms). Created 23 Hardhat unit and negative tests (100% pass rate). Tested deployment script `deploy_phase1.js`. Identity & Inspector Governance marked complete.
- **2026-10-02 (Phase 2 Land Registry Core & Duplicate Prevention):** Implemented `LandRegistry.sol` (authoritative land record, Layer 1 exact `parcelKey` duplicate prevention, jurisdiction containment, cryptographic anchors for geometry and documents, escrow locks, and identity-based ownership continuity). Created 14 unit and negative tests. Total test suite expanded to 37 passing tests (0 failures). Local deployment script `deploy_phase2.js` verified. Land Registration marked complete.
- **2026-10-02 (Phase 3 Escrow, Transfers & Milestone M2):** Implemented `TransferEscrow.sol` (exact funding constraint, multi-tier inspector approvals, high-value $\ge 5$ ETH Senior Inspector requirement, pull-payment disbursements, cancellation/expiry refunds, and atomic ownership settlement). Verified test cases TC01–TC10 with 10 passing tests (full contract suite reaches 47 passing tests, 0 failures). Verified local deployment script `deploy_phase3.js` deploying and cross-wiring the complete 4-contract suite. Smart contract foundation achieved (Milestone M2).
- **2026-10-02 (Phase 4 Backend Foundation: API, Database & Authentication):** Implemented the asynchronous FastAPI application, SQLAlchemy models (`User`, `WalletBinding`, `Jurisdiction`, `LandApplication`, `LandBoundary`, `Document`, `DocumentManifest`, `Land`, `Escrow`, `BlockchainEvent`, `AuditLog`), EIP-4361 SIWE signature verification with replay attack prevention and single-use challenge nonces, privacy-preserving mock KYC adapter, Unicode NFKC cadastral normalization with keccak256 parcel keys, and GeoJSON spherical area calculation. Verified complete Pytest test suite with 6 passing tests (100% green). Phase 4 complete.
- **2026-10-02 (Phase 5 Event Indexer & Read Model):** Implemented confirmation-aware background indexer daemon (`indexer/service.py`) tracking smart contract event logs across all 4 contracts. Enforced idempotency via compound relational unique constraint `(transaction_hash, log_index)`. Implemented reorg detection checking block hash continuity and marking orphaned forks. Created modular domain event handlers (`indexer/handlers/`) projecting changes onto derived read models (`lands`, `escrows`, `inspectors`, `users`). Built self-healing reconciliation engine (`indexer/reconciliation.py`) comparing database state with direct Web3 RPC smart contract calls, detecting tampering, and auto-restoring ground truth. Added CLI operations tool (`indexer/cli.py`). Verified 8 passing Pytest tests (idempotency replay, crash/restart recovery, reconciliation tamper self-healing, domain handlers). Total project tests reached 61 passing tests (47 Hardhat + 14 Pytest). Phase 5 complete.
- **2026-10-02 (Phase 6 Documents & Large-File Storage):** Implemented S3/MinIO private storage abstraction with constant-memory chunked streaming (`storage_service.py`), binary magic-byte inspection preventing MIME-type spoofing (`document_security.py`), document versioning with non-overwriting storage keys, order-independent canonical JSON manifest construction with SHA-256 anchoring (`manifest_service.py`), short-lived presigned download URLs with access auditing, and cryptographic tamper detection (`tamper_service.py`) identifying 4 corruption profiles (1-byte flip, truncation, file replacement, and on-chain mismatch). Verified 6 passing Pytest tests. Total project test suite expanded to 67 passing tests (47 Hardhat + 20 Pytest). Phase 6 complete. Proceeding to Phase 7 (Geospatial Validation and Maps).
