# Project Log — Blockchain Land Registry

Chronological record of technical decisions, architecture transitions, code changes, and phase completions.

---

### [2026-10-02 18:30:00 +05:30] — Phase 0: Foundations & Architecture Baseline
- **Context:** Project initialization and comprehensive master plan analysis.
- **Source Document Analyzed:** `Blockchain_Land_Registry_Master_Plan.docx` (Consolidated Edition, Oct 2, 2026).
- **Decisions Recorded:**
  1. **Network Selection:** Standardized strictly on Ethereum Sepolia Testnet (`11155111`). Previous references to Polygon Amoy or other testnets are formally deprecated.
  2. **Scope Boundaries:** Machine learning risk scoring, ML models, and dataset inference services are explicitly removed from scope. Replaced entirely by deterministic, verifiable, rule-based validation (smart contract uniqueness, PostGIS spatial overlap detection, SHA-256 document hashing).
  3. **Architectural Separation:** Transitioning from a single monolithic contract (`LandRegistry.sol`) to a 4-contract modular suite: `IdentityRegistry.sol`, `InspectorRegistry.sol`, `LandRegistry.sol`, `TransferEscrow.sol`.
  4. **The Four Truths Model:**
     - *Identity Truth:* KYC adapter (mock/isolated) + `IdentityRegistry` (1 identity ↔ 1 active wallet). No Aadhaar numbers, images, or hashes on-chain.
     - *Land Truth:* Authoritative land ownership & states anchored on `LandRegistry.sol`.
     - *Document Truth:* Private object storage (MinIO/S3) + canonical manifest SHA-256 anchored on-chain.
     - *Search Truth:* PostgreSQL + PostGIS derived read model populated idempotently via an event indexer.
  5. **Geospatial Drawing:** Google Maps Drawing Library was sunset in May 2026. Standardizing on editable `google.maps.Polygon` / Terra Draw for polygon capture.
- **Actions:**
  - Initialized `docs/project_log.md`.
  - Initialized authoritative `docs/technical_whitepaper.md` aligned with Phase 0 requirements.

---

### [2026-10-02 18:35:00 +05:30] — Phase 0: Monorepo Scaffolding & Specifications Freeze
- **Context:** Establishing the foundational monorepo structure, local infrastructure, and freezing all core architectural specifications.
- **Work Packages Completed:**
  1. **Monorepo Directory Layout:** Created clean subsystem directories:
     - `contracts/`: Smart contracts, Hardhat tests, deployment scripts.
     - `backend/`: FastAPI application, models, KYC adapter, SIWE auth.
     - `indexer/`: Confirmation-aware blockchain event ingestion daemon.
     - `frontend/`: React 18, Vite, Ethers.js, Material UI, Google Maps.
     - `infra/`: Docker Compose configurations for local development.
     - `docs/`: Master architectural and engineering specifications.
     - `scripts/`: Automation, seed scripts, and benchmark harnesses.
     - `deployments/`: Sepolia contract deployment artifacts.
  2. **Frozen Specification Suite (`v0.1-architecture`):**
     - `docs/architecture.md`: Frozen master system architecture, component boundaries, and settled design decisions.
     - `docs/contract-spec.md`: Complete specification for `IdentityRegistry`, `InspectorRegistry`, `LandRegistry`, and `TransferEscrow`.
     - `docs/database-schema.md`: Full PostgreSQL 16 + PostGIS 3.4 DDL, spatial indexes, and role-based permissions matrix.
     - `docs/api-spec.md`: FastAPI REST endpoints, SIWE authentication handshake, and request/response models.
     - `docs/security-model.md`: STRIDE threat matrix, trust boundaries, pull-payment protections, and zero-PII guarantees.
     - `docs/test-plan.md`: Unit test coverage targets, invariant fuzzing, and empirical research benchmarks (RQ1–RQ6).
  3. **Local Infrastructure:**
     - Created `infra/docker-compose.yml` for PostgreSQL 16 + PostGIS 3.4 and MinIO private S3 object storage.
     - Created `.env.example` defining network, RPC, database, storage, and security configuration variables.
  4. **Reproducibility & Deployment Artifacts:**
     - Created `docs/reproducibility_log.md` pinning toolchain versions.
     - Created `deployments/sepolia.json` template for tracking testnet deployments.
     - Created `.github/workflows/ci.yml` for continuous integration test automation.
- **Phase Status:** Phase 0 specifications frozen. Infrastructure defined.

---

### [2026-10-02 18:41:00 +05:30] — Phase 1: Identity & Inspector Governance Contracts
- **Context:** Implementing and testing on-chain identity binding, wallet loss recovery, and the 4-tier inspector governance hierarchy.
- **Contracts Implemented:**
  1. `contracts/src/IdentityRegistry.sol`:
     - Opaque platform identity (`bytes32 identityId`) bound to `address activeWallet`.
     - Invariant enforcement: Exactly 1 verified identity $\leftrightarrow$ 1 active wallet address.
     - Methods: `verifyAndBindIdentity()`, `recoverWallet()`, `revokeWallet()`, `isWalletActive()`, `isVerified()`, `getIdentityByWallet()`, `getActiveWalletByIdentity()`.
     - Uses OpenZeppelin v5 `AccessControlEnumerable` and `Pausable`.
  2. `contracts/src/InspectorRegistry.sol`:
     - 4-tier hierarchy: Level 0 (System Admin), Level 1 (Regional Registrar), Level 2 (Senior Inspector), Level 3 (Field Inspector).
     - Geographic containment: `jurisdictionId` enforcement.
     - Methods: `addInspector()`, `revokeInspector()`, `removeInspector()`, `changeInspectorLevel()`, `assignJurisdiction()`, `isAuthorized()`, `isAuthorizedInspector()`.
     - Universal admin override (`jurisdictionId = 0`), appointment expiration checks (`validUntil`).
- **Tests & Validation:**
  - `contracts/test/IdentityRegistry.test.js`: 11 passing tests covering binding, duplicate wallet/identity rejection, recovery, revocation, and non-admin unauthorized calls.
  - `contracts/test/InspectorRegistry.test.js`: 12 passing tests covering admin appointment, registrar jurisdiction containment, hierarchy restriction, authorization checking, cross-jurisdiction rejection (RQ1), expired inspectors, and revoked inspectors.
  - Test Suite Result: 23 passing tests (0 failures).
  - Created and verified deployment script: `contracts/scripts/deploy_phase1.js`.
  - Created and verified seed script: `contracts/scripts/seed_phase1.js` (seeding Admin, Registrars for Pune & Nashik, Senior Inspector, Field Inspector, and Citizens).
- **Phase Status:** Phase 1 complete. Proceeding to Phase 2 (Land Registry Core & Duplicate Prevention).

---

### [2026-10-02 18:55:00 +05:30] — Phase 2: Land Registry Core & Duplicate Prevention
- **Context:** Implementing authoritative on-chain land registration, cryptographic parcel uniqueness (`parcelKey`), multi-inspector verification, and escrow settlement hooks.
- **Contract Implemented:**
  - `contracts/src/LandRegistry.sol`:
    - Minimal authoritative record: `parcelKey`, `ownerIdentityId`, `jurisdictionId`, `status`, `geometryHash`, `documentManifestHash`, `registeredAt`, `verifiedAt`, `activeTransferId`.
    - **Layer 1 Duplicate Prevention:** `_parcelExists[parcelKey]` mapping reverts any duplicate registration attempts with `DuplicateParcelKey`.
    - **Identity Integration:** Land is owned by `bytes32 ownerIdentityId` rather than a raw address, guaranteeing seamless wallet recovery without orphan land records.
    - **Jurisdiction Containment:** Calls `inspectorRegistry.isAuthorized()` to ensure inspectors can only register or verify land inside their assigned jurisdiction.
    - **Escrow Settlement Hooks:** `lockForTransfer()`, `unlockFromTransfer()`, and `executeOwnershipTransfer()` callable strictly by designated `escrowContract`.
- **Tests & Validation:**
  - `contracts/test/LandRegistry.test.js`: 14 passing tests covering:
    - Inspector jurisdiction-verified registration.
    - Strict revert on duplicate parcel keys (Layer 1 duplicate defense).
    - Unverified owner rejection.
    - Wrong jurisdiction inspector rejection for both registration and verification.
    - Escrow locking, unlocking, and atomic ownership transfer.
    - Identity-based ownership continuity during wallet recovery.
  - Full Test Suite Result: **37 passing tests (0 failures)** across all 3 contracts.
  - Created and verified deployment script: `contracts/scripts/deploy_phase2.js` (deploying and wiring `IdentityRegistry`, `InspectorRegistry`, and `LandRegistry`).
- **Phase Status:** Phase 2 complete. Proceeding to Phase 3 (Escrow, Transfers and Contract Completion).

---

### [2026-10-02 19:05:00 +05:30] — Phase 3: Escrow, Transfers and Contract Completion (Milestone M2)
- **Context:** Implementing financial custody, exact-payment protection, multi-inspector approvals, atomic settlement, and pull-payments for property acquisitions.
- **Contract Implemented:**
  - `contracts/src/TransferEscrow.sol`:
    - Full State Machine: `REQUESTED` $\rightarrow$ `FUNDED` $\rightarrow$ `UNDER_REVIEW` $\rightarrow$ `APPROVED` $\rightarrow$ `COMPLETED` (with `CANCELLED`, `EXPIRED`, `REJECTED` $\rightarrow$ `REFUNDED` safety paths).
    - **Exact Payment Enforcement:** `require(msg.value == agreedPrice)` reverts both underpayment and overpayment.
    - **Pull-Payment Pattern:** Seller proceeds and buyer refunds are credited to internal pending withdrawals, collected via `withdrawFunds()`, preventing reentrancy and griefing attacks.
    - **Atomic Settlement:** Title reassignment in `LandRegistry` and payment release in `TransferEscrow` occur within the same transaction execution context.
    - **High-Value Governance:** Transfers with `agreedPrice >= 5 ETH` require at least two approvals, including a Senior Inspector (Level 2).
- **Tests & Validation:**
  - `contracts/test/TransferEscrow.test.js`: 10 empirical tests validating test cases TC01–TC10:
    - TC01: Correct deposit and funding state.
    - TC02 & TC03: Underpayment and overpayment reverts.
    - TC04, TC05, TC06: Settlement and release controls (revert on unauthorized release, settle on approved transfer, revert on double release).
    - TC07 & TC08: Cancellation and expiry refund paths via pull-payment.
    - High-Value Governance: Strict Senior Inspector requirement for $\ge 5$ ETH.
    - Invariant: Contract balance strictly equals sum of active deposits + pending withdrawals.
  - Full Test Suite Result: **47 passing tests (0 failures)** across all 4 contracts.
  - Deployment Automation: Created and verified [`contracts/scripts/deploy_phase3.js`](file:///d:/New_land_registry/contracts/scripts/deploy_phase3.js) deploying and cross-wiring the complete 4-contract architecture.
- **Phase Status:** Milestone M2 achieved! Smart contract tier complete. Proceeding to Phase 4 (Backend Foundation: API, Database & Authentication).

---

### [2026-10-02 21:58:00 +05:30] — Managerial Directive: Scope Freeze & Enhancements Backlog
- **Context:** Management paused execution to perform an exhaustive architectural audit and catalog production enhancements.
- **Decision Taken:**
  - Management instructed that all 28 proposed production enhancements be archived into a dedicated backlog file in the root directory: `FUTURE_PRODUCTION_ENHANCEMENTS.md`.
  - Active implementation remains **strictly bound** to the baseline specification in `Blockchain_Land_Registry_Master_Plan.docx`.
  - Zero out-of-scope additions will enter active development until the entire master plan is delivered end-to-end.
- **Actions:**
  - Created [`FUTURE_PRODUCTION_ENHANCEMENTS.md`](file:///d:/New_land_registry/FUTURE_PRODUCTION_ENHANCEMENTS.md) cataloging all 28 enterprise enhancements across 7 domains.
  - Reaffirmed that active work proceeds strictly under Phase 4 of `Blockchain_Land_Registry_Master_Plan.docx`.

---

### [2026-10-02 22:15:00 +05:30] — Phase 4: Backend Foundation: API, Database & Authentication [COMPLETED]
- **Context:** Implementing the FastAPI application, SQLAlchemy async PostgreSQL models, EIP-4361 Sign-In with Ethereum (SIWE) authentication, mock KYC provider, cadastral normalization, and draft application workflow.
- **Components Implemented:**
  1. **Core Configuration & Database Layer:**
     - `backend/app/config.py`: Pydantic settings loading RPC endpoints, database credentials, JWT secrets, and chain ID (Sepolia `11155111`).
     - `backend/app/database.py`: SQLAlchemy async engine and sessionmaker (`postgresql+asyncpg` / `sqlite+aiosqlite`).
  2. **Relational & Derived Read Models (`backend/app/models/models.py`):**
     - User, WalletBinding, Jurisdiction, LandApplication, LandBoundary, Document, DocumentManifest.
     - Derived read models: Land, Escrow, BlockchainEvent, AuditLog.
  3. **SIWE Wallet Authentication (`backend/app/services/auth_service.py`):**
     - Cryptographically secure single-use challenge nonces with 5-minute expiry.
     - Strict EIP-4361 message parsing and signature recovery with chain ID and domain validation.
     - Replay attack rejection and JWT access token issuance.
  4. **Mock KYC Adapter (`backend/app/services/kyc_adapter.py`):**
     - Privacy-preserving KYC verification producing deterministic, opaque `bytes32` identity UUIDs with zero PII stored on-chain.
  5. **Application Service (`backend/app/services/application_service.py`):**
     - Unicode NFKC cadastral text normalization and deterministic `parcelKey` generation via keccak256.
     - Spherical GeoJSON area calculation and canonical `geometryHash` generation.
  6. **FastAPI Endpoints (`backend/app/api/v1/`):**
     - `/auth/nonce`, `/auth/verify`, `/auth/me`, `/auth/kyc/verify`.
     - `/applications/draft`, `/applications/{id}`, `/applications/{id}/review`.
     - `/lands/`, `/lands/{land_id}`.
- **Tests & Validation:**
  - `backend/tests/test_auth.py` and `backend/tests/test_applications.py`:
    - Valid nonce issuance.
    - Full EIP-4361 SIWE signature verification and JWT token issuance.
    - Replay attack rejection on reused nonces.
    - Signature validation against wrong chain ID.
    - Draft land application creation with cadastral normalization, `parcelKey` generation, and GeoJSON area calculation.
    - Strict rejection of duplicate draft applications with the same `parcelKey`.
  - Test Suite Result: **6 passing tests (0 failures, 100% green)** in 0.45s.
- **Phase Status:** Phase 4 complete. Proceeding to Phase 5 (Event Indexer and Read Model).

---

### [2026-10-02 22:30:00 +05:30] — Phase 5: Event Indexer & Read Model [COMPLETED]
- **Context:** Implementing the background event indexing daemon, confirmation-aware log processor, idempotent event materializer, reorg handler, and self-healing reconciliation engine.
- **Components Implemented:**
  1. **Indexer Configuration & ABI Loader (`indexer/config.py`, `indexer/abi_loader.py`):**
     - Configurable confirmation depth (1 for local, 6 for Sepolia), batch size, RPC endpoints, and poll intervals.
     - Hardhat artifact ABI parser caching ABI definitions across all 4 contracts.
  2. **EVM Log Parser (`indexer/event_parser.py`):**
     - Topic0 keccak hash resolution to event signatures.
     - HexBytes and nested argument serialization into typed JSON-friendly Python objects.
  3. **Modular Domain Event Handlers (`indexer/handlers/`):**
     - `identity_handlers.py`: `IdentityBound`, `WalletRecovered`, `WalletRevoked`.
     - `inspector_handlers.py`: `InspectorAdded`, `InspectorRevoked`, `InspectorLevelChanged`, `InspectorJurisdictionChanged`.
     - `land_handlers.py`: `LandRegistered`, `LandVerified`, `LandRejected`, `LandLockedForTransfer`, `LandUnlockedFromTransfer`, `OwnershipTransferred`.
     - `escrow_handlers.py`: `TransferRequested`, `EscrowFunded`, `TransferUnderReview`, `TransferApproved`, `TransferCompleted`, `TransferCancelled`, `TransferRejected`, `TransferExpired`, `TransferRefunded`, `FundsWithdrawn`.
  4. **Core Indexer Engine (`indexer/service.py`):**
     - Confirmation-aware block boundary processing (`latest_block - confirmation_depth`).
     - Atomic database transaction per event ensuring `(transaction_hash, log_index)` uniqueness and projection onto read model tables.
     - Reorg detection checking parent block hash consistency and marking orphaned event records.
  5. **Reconciliation & Self-Healing Engine (`indexer/reconciliation.py`):**
     - Cross-references PostgreSQL read-model records against authoritative on-chain state via direct Web3 RPC calls.
     - Emits `SYNC_ERROR_DETECTED` audit logs upon divergence and automatically self-heals corrupted records, logging `SYNC_ERROR_REPAIRED`.
  6. **CLI Operations Tool (`indexer/cli.py`):**
     - Subcommands: `run` (daemon), `backfill` (block ranges), `reconcile` (audit & heal), and `status` (lag metrics).
- **Tests & Validation:**
  - `indexer/tests/test_event_handlers.py`: 4 tests validating identity binding, wallet recovery, inspector hierarchy, land verification, transfer locking, and escrow state transitions.
  - `indexer/tests/test_idempotency.py`: 2 tests validating exact event replay with zero duplicates, and mid-batch crash/restart recovery with zero gaps.
  - `indexer/tests/test_reconciliation.py`: 2 tests validating detection and automated self-healing of manually corrupted land and escrow records.
  - Test Suite Result: **8 passing tests (0 failures, 100% green)** in 0.72s.
  - Combined Monorepo Result: **47 Hardhat contract tests + 14 Python tests = 61 passing tests (0 failures)**.
- **Phase Status:** Phase 5 complete. Proceeding to Phase 6 (Documents and Large-File Storage).

---

### [2026-10-02 22:35:00 +05:30] — Repository Milestone: GitHub Synchronization
- **Context:** Management requested pushing the entire codebase, contracts, backend, indexer, documentation, and test suites to remote repository.
- **Repository Linked:** [`https://github.com/Zenkairow/Cadastra`](https://github.com/Zenkairow/Cadastra)
- **Actions:**
  - Initialized Git repository on `main` branch.
  - Created `.gitignore` excluding dependency caches, build outputs, local database files, and environment secrets while preserving code, specifications, and ABI artifacts.
  - Exported canonical contract ABIs into `deployments/abi/` for decoupled cross-language access.
  - Authored comprehensive root [`README.md`](file:///d:/New_land_registry/README.md) featuring architecture diagrams, system invariants, quickstart commands, and roadmap status.
  - Successfully committed 78 files and pushed to `origin/main` (`commit 7c34e28`).
- **Working Tree Status:** Clean, synchronized with `origin/main`.
