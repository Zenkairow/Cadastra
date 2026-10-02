# Reproducibility & Environment Record

**Project:** Blockchain Land Registry  
**Test Network:** Ethereum Sepolia (Chain ID `11155111`)  

---

## 1. Toolchain & Runtime Versions
- **Operating System:** Windows 10/11 x64
- **Node.js:** v20.x LTS (pinned)
- **Solidity Compiler (`solc`):** `0.8.24`
- **Hardhat:** `^2.22.0`
- **OpenZeppelin Contracts:** `^5.0.0`
- **Python:** `3.11+`
- **FastAPI:** `^0.111.0`
- **SQLAlchemy:** `^2.0.30`
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

## 3. Verified Test Suite Baselines (Phases 0–7)

- **Total Monorepo Passing Tests:** **80 tests (100% green, 0 failures)**
  - **Hardhat Smart Contract Suite:** 49 tests passing
    - `IdentityRegistry.test.js`: 11 tests
    - `InspectorRegistry.test.js`: 12 tests
    - `LandRegistry.test.js`: 16 tests (including cross-layer shared parcel key test vectors)
    - `TransferEscrow.test.js`: 10 tests (TC01–TC10 financial custody rules)
  - **Pytest Backend, Geospatial, Documents & Indexer Suite:** 31 tests passing
    - `test_applications.py`: 3 tests (including cross-layer parcel key test vector normalization)
    - `test_auth.py`: 4 tests (EIP-4361 SIWE authentication & replay defense)
    - `test_documents.py`: 6 tests (constant memory stream hashing, magic bytes, tamper verification)
    - `test_geospatial.py`: 10 tests (OGC topology, geodesic area, rotation-invariant hash, overlap engine)
    - `test_event_handlers.py`: 4 tests (domain event projections)
    - `test_idempotency.py`: 2 tests (replay safety & crash recovery)
    - `test_reconciliation.py`: 2 tests (self-healing detection & automated repair)

---

## 4. Benchmark Reproduction Commands

- **RQ2 Duplicate Land & Spatial Detection (Phase 7):**
  ```bash
  python scripts/generate_synthetic_parcels.py --count 1000 --benchmark --output docs/benchmark_rq2_geospatial.json
  python scripts/generate_synthetic_parcels.py --count 10000 --benchmark --output docs/benchmark_10k_parcels.json
  ```
  - Result: 100% duplicate detection, 100% partial encroachment detection, 0.0% shared boundary false alarms, >960 evaluations/sec (1,000 parcels), >330 evaluations/sec (10,000 parcels).

- **RQ5 Document Tamper Detection (Phase 6):**
  ```bash
  python -m pytest backend/tests/test_documents.py -k test_tamper_detection_experiment_all_profiles -v
  ```
  - Result: 100% detection of 1-byte flip, metadata change, file replacement, and on-chain hash divergence.

- **RQ4 Indexer Idempotency & Reconciliation (Phase 5):**
  ```bash
  python -m pytest indexer/tests/ -v
  ```
  - Result: Exact replay idempotency, mid-batch crash/restart recovery, and automated DB/chain reconciliation repair.

