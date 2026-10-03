# Reproducibility & Environment Record

**Project:** Blockchain Land Registry  
**Test Network:** Ethereum Sepolia (Chain ID `11155111`)  

---

## 1. Toolchain & Runtime Versions
- **Operating System:** Windows 11 x64
- **Node.js:** v22.18.0 (npm v10.9.3)
- **Solidity Compiler (`solc`):** `0.8.24` (Cancun EVM Target, optimizer runs: 200)
- **Hardhat:** `v2.22.19`
- **OpenZeppelin Contracts:** `v5.0.0`
- **Python:** `3.13.5`
- **FastAPI:** `0.115.6`
- **SQLAlchemy:** `2.0.36`
- **PostgreSQL / PostGIS:** PostgreSQL 16.2 / PostGIS 3.4
- **MinIO:** RELEASE.2024-05-10T01-41-38Z

---

## 2. Sepolia Deployments Registry
*(Populated during contract deployment milestones)*

| Contract Name | Deployed Address | Deployment Tx Hash | Block Number | Explorer Verification Link |
| :--- | :--- | :--- | :--- | :--- |
| `IdentityRegistry` | `TBD` | `TBD` | `TBD` | `TBD` |
| `InspectorRegistry` | `TBD` | `TBD` | `TBD` | `TBD` |
| `LandRegistry` | `TBD` | `TBD` | `TBD` | `TBD` |
| `TransferEscrow` | `TBD` | `TBD` | `TBD` | `TBD` |

---

## 3. Verified Test Suite Baselines (Phases 0–10)

- **Total Monorepo Passing Tests:** **98 tests (100% green, 0 failures)**
  - **Hardhat Smart Contract Suite:** 68 tests passing (4.02s)
    - `IdentityRegistry.test.js`: 11 tests (identity binding, 1-to-1 invariant, wallet recovery)
    - `InspectorRegistry.test.js`: 12 tests (4-tier hierarchy, jurisdiction containment, expiration)
    - `LandRegistry.test.js`: 16 tests (parcel registration, duplicate rejection, cross-layer test vectors)
    - `TransferEscrow.test.js`: 10 tests (TC01–TC10 financial custody rules)
    - `SecurityHardening.test.js`: 19 tests (Access Control Matrix `ACM-01..08`, `NEG-01..05`, `PAUSE-01..03`, `REENT-01`, `INV-01`, `DOS-01`)
  - **Pytest Backend, Geospatial, Documents & Security Suite:** 30 tests passing (1.15s)
    - `test_applications.py`: 3 tests (cadastral normalization & parcel key test vectors)
    - `test_auth.py`: 4 tests (EIP-4361 SIWE authentication & replay defense)
    - `test_documents.py`: 6 tests (constant memory stream hashing, magic bytes, tamper verification)
    - `test_geospatial.py`: 10 tests (OGC topology, geodesic area, rotation-invariant hash, overlap engine)
    - `test_security.py`: 7 tests (rate limiting, path traversal, magic-byte spoofing, zero-PII invariant, single-use SIWE nonces)

---

## 4. Benchmark Reproduction Commands (Phase 10 / Milestone M5 Evidence)

### Master One-Click Runner
```bash
python scripts/run_all_experiments.py
```

### Individual Benchmark Commands
- **Gas Profiling Analysis:**
  ```bash
  cd contracts && npx hardhat run scripts/gas_profiler.js
  ```
  - Output: `docs/benchmark_gas_profile.json` & `docs/benchmark_gas_profile.csv`

- **RQ1 Inspector Hierarchy & Authorization Matrix:**
  ```bash
  cd contracts && npx hardhat run scripts/experiment_rq1_authorization.js
  ```
  - Output: `docs/benchmark_rq1_authorization.json` (120 trials, 100% accuracy)

- **RQ2 Duplicate Land & Spatial Detection (1,000 to 10,000 Parcels):**
  ```bash
  python scripts/generate_synthetic_parcels.py --count 1000 --benchmark --output docs/benchmark_rq2_geospatial.json
  python scripts/generate_synthetic_parcels.py --count 10000 --benchmark --output docs/benchmark_10k_parcels.json
  ```
  - Output: `docs/benchmark_rq2_geospatial.json` & `docs/benchmark_10k_parcels.json`

- **RQ3 Escrow Test Cases (TC01–TC10):**
  ```bash
  cd contracts && npx hardhat run scripts/experiment_rq3_escrow.js
  ```
  - Output: `docs/benchmark_rq3_escrow.json` & `docs/benchmark_rq3_escrow.csv`

- **RQ4 Event Synchronization & Self-Healing Reconciliation:**
  ```bash
  python scripts/experiment_rq4_synchronization.py
  ```
  - Output: `docs/benchmark_rq4_synchronization.json` & `docs/benchmark_rq4_synchronization.csv` (1,735+ events/sec, 6.11ms repair)

- **RQ5 Document Integrity & Tamper Detection:**
  ```bash
  python scripts/experiment_rq5_document_integrity.py
  ```
  - Output: `docs/benchmark_rq5_document_integrity.json` & `docs/benchmark_rq5_document_integrity.csv` (100% detection across 400 instances)

- **RQ6 Read Scalability & Dashboard Latency (10 to 5,000 records):**
  ```bash
  python scripts/experiment_rq6_read_scaling.py
  ```
  - Output: `docs/benchmark_rq6_read_scaling.json` & `docs/benchmark_rq6_read_scaling.csv` (up to 725x speedup, 100% RPC reduction)

