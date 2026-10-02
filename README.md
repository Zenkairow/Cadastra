# Cadastra — Decentralized Blockchain Land Registry & E-Governance Platform

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum%20Sepolia-blue)](https://sepolia.etherscan.io)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Tests](https://img.shields.io/badge/Tests-67%20Passing-brightgreen)](#testing--verification)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Cadastra** is a hierarchical, identity-bound, blockchain-based land registry with escrow-secured ownership transfer, geospatial duplicate prevention, tamper-evident document storage, and event-driven off-chain synchronization.

---

## 🏛️ Core Architectural Foundations: The Four Truths

Cadastra partitions responsibilities across four distinct layers to achieve cryptographic security without sacrificing high-performance searchability:

| Truth Domain | Storage Location | Invariant / Security Guarantee |
| :--- | :--- | :--- |
| **1. Identity Truth** | Isolated KYC Adapter + `IdentityRegistry.sol` | Exactly 1 verified identity $\leftrightarrow$ 1 active wallet address. Zero PII stored on-chain. |
| **2. Land Truth** | `LandRegistry.sol` + `TransferEscrow.sol` | Authoritative parcel ownership, status, transfer locks, and atomic title settlement. |
| **3. Document Truth** | Private S3 / MinIO + SHA-256 Manifest Anchor | Documents stored privately off-chain; canonical manifest hash anchored on-chain. |
| **4. Search Truth** | PostgreSQL 16 + PostGIS 3.4 Read Model | Derived, queryable relational and spatial model populated idempotently via an event indexer. |

---

## 📐 Smart Contract Architecture (Solidity 0.8.24 / Cancun EVM)

```
                 +-----------------------+
                 |  IdentityRegistry.sol |
                 | (1 ID <-> 1 Wallet)   |
                 +-----------+-----------+
                             ^
                             | Identity lookup & wallet recovery
                             v
+-------------------------+  |  +-------------------------+
|  InspectorRegistry.sol  |<-+->|    LandRegistry.sol     |
| (4-Tier Governance)     |     | (Authoritative Parcel)  |
+-------------------------+     +------------+------------+
                                             ^
                                             | Escrow hooks (lock/unlock/settle)
                                             v
                                +-------------------------+
                                |   TransferEscrow.sol    |
                                | (Exact Funding & Pull)  |
                                +-------------------------+
```

1. **`IdentityRegistry.sol`:** Maps opaque platform UUIDs to active wallet addresses, enforcing a strict 1-to-1 invariant. Includes wallet loss and recovery workflows that preserve citizen land ownership without rewriting land records.
2. **`InspectorRegistry.sol`:** Enforces a 4-tier inspector hierarchy (System Admin, Regional Registrar, Senior Inspector, Field Inspector) with strict geographical jurisdiction containment.
3. **`LandRegistry.sol`:** Holds authoritative land records. Enforces Layer 1 duplicate prevention via `keccak256(canonicalIdentifier)`, multi-inspector verification, and cryptographic anchors for boundaries (`geometryHash`) and deeds (`documentManifestHash`).
4. **`TransferEscrow.sol`:** Manages property acquisition funds. Reverts underpayment/overpayment, requires Senior Inspector approval for $\ge 5$ ETH transactions, executes atomic title transfer upon settlement, and disburses proceeds via reentrancy-safe pull payments (`withdrawFunds()`).

---

## 🔄 Event Indexer & Self-Healing Read Model (`indexer/`)

- **Confirmation-Aware Ingestion:** Tracks Sepolia blocks with a 6-block confirmation depth to prevent processing reorganized or transient blocks.
- **Strict Idempotency:** Relational unique constraint `(transaction_hash, log_index)` ensures events are recorded and projected exactly once.
- **Reconciliation Engine (`indexer/reconciliation.py`):** Cross-references database records with direct Web3 RPC smart contract reads. If an unauthorized database edit occurs, the engine detects the mismatch, issues a `SYNC_ERROR_DETECTED` audit alert, and automatically restores on-chain ground truth (`SYNC_ERROR_REPAIRED`).

---

## 🚀 Repository Layout

```
├── .agents/             # Agentic rules, specifications, and execution instructions
├── backend/             # FastAPI backend, async SQLAlchemy models, EIP-4361 SIWE auth
├── contracts/           # Solidity smart contracts, Hardhat test suite, deployment scripts
├── deployments/         # Sepolia deployment records, compiler settings, exported ABIs
├── docs/                # Architecture specs, database DDL, technical whitepaper & project log
├── frontend/            # React 18 / Vite application and mapping interface
├── indexer/             # Blockchain event listener daemon, domain handlers & reconciliation
├── infra/               # Docker Compose (PostgreSQL 16 + PostGIS 3.4, MinIO S3 storage)
└── scripts/             # Automation, seed harnesses, and benchmark tooling
```

---

## 🧪 Testing & Verification

The project includes an empirical, multi-layer automated test suite:

### 1. Smart Contract Tests (49 Passing Tests)
```bash
cd contracts
npm test
```
- Identity binding, duplicate wallet/identity rejection, and recovery transitions.
- Inspector jurisdiction containment and hierarchical appointment restrictions.
- Parcel duplicate collision rejection (Layer 1 duplicate defense).
- Cross-layer shared parcel key test vectors verifying off-chain normalization against on-chain hashing.
- Financial custody test cases TC01–TC10 (exact payments, pull disbursements, cancellation refunds, high-value governance, balance invariant).

### 2. Backend, Storage, Geospatial & Indexer Tests (31 Passing Tests)
```bash
python -m pytest backend/tests/ indexer/tests/ -v
```
- EIP-4361 Sign-In with Ethereum (SIWE) signature verification, nonces, and replay protection.
- Cadastral normalization (Unicode NFKC) and keccak256 parcel keys.
- S3/MinIO constant-memory chunked streaming SHA-256 calculation.
- Binary magic-byte inspection preventing file extension/MIME spoofing.
- Document versioning pipeline and canonical manifest generation.
- Empirical tamper detection across 4 corruption profiles (1-byte flip, truncation, file replacement, on-chain hash mismatch).
- OGC topological validation and ellipsoidal geodesic area calculation on WGS 84.
- Rotation- and winding-order-invariant canonical `geometryHash` generation.
- Layer 2 spatial overlap and encroachment detection engine (differentiating shared property lines from duplicate parcels).
- Synthetic cadastral dataset generator (RQ2) benchmarking duplicate detection with 100% precision/recall at 960+ evaluations/sec.
- Indexer exact event replay idempotency (zero duplicate records).
- Crash/restart recovery (zero gaps, continuous ingestion).
- Automated reconciliation detection and self-healing of tampered records.

---

## 🚦 Phased Roadmap Status

- [x] **Phase 0:** Foundations & Architecture Freeze
- [x] **Phase 1:** Identity & Inspector Governance Contracts
- [x] **Phase 2:** Land Registry Core & Duplicate Prevention
- [x] **Phase 3:** Escrow, Transfers & Contract Completion (Milestone M2)
- [x] **Phase 4:** Backend Foundation: API, Database & Authentication
- [x] **Phase 5:** Event Indexer & Read Model
- [x] **Phase 6:** Documents & Large-File Storage (MinIO S3 Multipart & Manifest Hashing)
- [x] **Phase 7:** Geospatial Validation & Maps (PostGIS Spatial Overlap & Canonical Geometry)
- [ ] **Phase 8:** Frontend & End-to-End Integration (Milestone M4)
- [ ] **Phase 9:** Security Hardening & Verification (Milestone M5)
- [ ] **Phase 10:** Performance Measurement & Research Experiments (RQ1–RQ6)
- [ ] **Phase 11:** Release, Documentation & Research Paper (Milestone M6)

---

## 📖 Authoritative Documentation

- Master Whitepaper: [`docs/technical_whitepaper.md`](docs/technical_whitepaper.md)
- Chronological Engineering Log: [`docs/project_log.md`](docs/project_log.md)
- System Architecture Spec: [`docs/architecture.md`](docs/architecture.md)
- Database Schema DDL: [`docs/database-schema.md`](docs/database-schema.md)
- Security Threat Matrix: [`docs/security-model.md`](docs/security-model.md)

---

## 📄 License
This project is licensed under the MIT License.
