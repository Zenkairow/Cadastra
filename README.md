# Cadastra — Decentralized Blockchain Land Registry & E-Governance Platform

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum%20Sepolia-blue)](https://sepolia.etherscan.io)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React 18](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-61DAFB?logo=react)](frontend/)
[![Tests](https://img.shields.io/badge/Tests-98%20Passing-brightgreen)](#testing--verification)
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

## 🧪 Testing & Verification### 1. Smart Contract Test Suite (68 Passing Tests)
```bash
cd contracts && npm test
```
- Identity binding, duplicate wallet/identity rejection, and recovery transitions.
- Inspector jurisdiction containment and hierarchical appointment restrictions.
- Parcel duplicate collision rejection (Layer 1 duplicate defense).
- Cross-layer shared parcel key test vectors verifying off-chain normalization against on-chain hashing.
- Financial custody test cases TC01–TC10 (exact payments, pull disbursements, cancellation refunds, high-value governance, balance invariant).
- Access Control Matrix ($Role \times Function \times State$) adversarial coverage across all contracts (`ACM-01` to `ACM-08`).
- Negative revert coverage across 100% of custom Solidity errors (`NEG-01` to `NEG-05`).
- Pausable emergency circuit breakers halting state-changing executions under anomalies (`PAUSE-01` to `PAUSE-03`).
- Malicious reentrancy attack immunity (`MaliciousReceiver.sol`, `REENT-01`) and pull-payment invariant verification.

### 2. Backend, Storage, Geospatial & Security Tests (30 Passing Tests)
```bash
python -m pytest backend/tests/ -v
```
- EIP-4361 Sign-In with Ethereum (SIWE) signature verification, single-use nonces, and replay protection.
- Cadastral normalization (Unicode NFKC) and keccak256 parcel keys.
- S3/MinIO constant-memory chunked streaming SHA-256 calculation.
- Binary magic-byte inspection preventing file extension/MIME spoofing.
- Document versioning pipeline and canonical manifest generation.
- Empirical tamper detection across 4 corruption profiles (1-byte flip, truncation, file replacement, on-chain hash mismatch).
- OGC topological validation and ellipsoidal geodesic area calculation on WGS 84.
- Rotation- and winding-order-invariant canonical `geometryHash` generation.
- Layer 2 spatial overlap and encroachment detection engine (differentiating shared property lines from duplicate parcels).
- Synthetic cadastral dataset generator (RQ2) benchmarking duplicate detection with 100% precision/recall at 960+ evaluations/sec.
- OWASP API Top 10 sliding-window rate limiters (15 req/min auth, 20 req/min upload).
- Filename path-traversal (`..`, `/`, `\`) and null-byte (`\x00`) sanitization.
- Formally verified Zero-PII storage invariant across all database models and schemas.

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
- [x] **Phase 8:** Frontend & End-to-End Integration (Milestone M4)
- [x] **Phase 9:** Security Hardening & Verification (Milestone M5)
- [x] **Phase 10:** Performance Measurement & Research Experiments (RQ1–RQ6)
- [x] **Phase 11:** Release, Documentation & Research Paper (Milestone M6)

---

## 📖 Authoritative Documentation

- Master Whitepaper: [`docs/technical_whitepaper.md`](docs/technical_whitepaper.md)
- Chronological Engineering Log: [`docs/project_log.md`](docs/project_log.md)
- Academic Research Paper Draft: [`docs/research_paper.md`](docs/research_paper.md)
- Clean-Machine Setup Guide & Runbook: [`docs/setup_guide.md`](docs/setup_guide.md)
- Three-Scenario Demonstration Script: [`docs/demonstration_script.md`](docs/demonstration_script.md)
- Consolidated Quality Assurance & Test Report: [`docs/test_report.md`](docs/test_report.md)
- Milestone M5 Empirical Research Results: [`docs/experiment_results.md`](docs/experiment_results.md)
- Milestone M5 Security Report: [`docs/security_report.md`](docs/security_report.md)
- Role Manuals:
  - [Citizen & Landowner Manual](docs/manual_citizen.md)
  - [Land Inspector & Senior Inspector Manual](docs/manual_inspector.md)
  - [System Administrator & Registrar Manual](docs/manual_admin.md)
- Project Retrospective & Lessons Learned: [`docs/retrospective.md`](docs/retrospective.md)
- System Architecture Spec: [`docs/architecture.md`](docs/architecture.md)
- Database Schema DDL: [`docs/database-schema.md`](docs/database-schema.md)
- Security Threat Matrix: [`docs/security-model.md`](docs/security-model.md)

---

## 📄 License
This project is licensed under the MIT License.
