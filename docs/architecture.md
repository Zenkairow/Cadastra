# Architecture Specification (Phase 0 Freeze)

**Project:** Blockchain Land Registry  
**Edition:** Consolidated Master Edition  
**Target Network:** Ethereum Sepolia Testnet (Chain ID `11155111`)  
**Status:** Frozen v0.1  

---

## 1. Executive Overview & Problem Context
Traditional land governance is plagued by opaque record-keeping, vulnerable single points of administration, boundary disputes, and fraudulent double-selling of parcels. 
This platform implements an auditable, multi-tier land governance architecture that couples:
1. **On-Chain Cryptographic Finality:** Authoritative land titles, state machines, and financial escrow executed by immutable smart contracts on Ethereum Sepolia.
2. **Off-Chain Spatial & Document Engine:** Sub-meter boundary overlap detection using PostGIS and tamper-evident document hashing via private MinIO/S3 object storage.
3. **Idempotent Synchronization:** A derived PostgreSQL read-model powered by a confirmation-aware event indexer, eliminating slow, unscalable direct blockchain loops.

---

## 2. The Four Kinds of Truth
| Truth Domain | Authority / Engine | Responsibility | Storage Paradigm |
| :--- | :--- | :--- | :--- |
| **Identity Truth** | Mock KYC Adapter + `IdentityRegistry.sol` | "Who is this person?" Enforces 1-to-1 verified identity $\leftrightarrow$ active wallet binding. | Off-chain KYC DB + On-chain pseudonymous mapping |
| **Land Truth** | `LandRegistry.sol` | "What parcel exists and who owns it?" Authoritative state machine & unique parcel keys. | Ethereum Sepolia Smart Contract State |
| **Document Truth** | MinIO/S3 + SHA-256 Manifest | "Have legal deeds or maps been tampered with?" | Private object store + on-chain `manifestHash` |
| **Search Truth** | PostgreSQL 16 + PostGIS 3.4 | "How to query, filter, and paginate fast?" | Derived read-model reconstructed from events |

---

## 3. High-Level System Architecture Diagram
```
                     +----------------------------------------------------+
                     |                 PRESENTATION LAYER                 |
                     |      React 18 + Vite + Ethers.js v6 + MUI v5       |
                     |      Google Maps JS API / Editable Polygon         |
                     +-----------------+----------------+-----------------+
                                       |                |
                       Signed Transactions            REST API / SIWE
                                       |                |
                                       v                v
+----------------------------------------+   +------------------------------------+
|            BLOCKCHAIN LAYER            |   |         APPLICATION LAYER          |
|           (Ethereum Sepolia)           |   |       FastAPI (Python 3.11+)       |
|                                        |   |                                    |
| [IdentityRegistry]                     |   | - EIP-4361 Sign-In with Ethereum   |
|         ^                              |   | - Mock KYC Provider Adapter        |
|         | verifies active wallet       |   | - GeoJSON Normalizer & WGS84 Calc  |
| [InspectorRegistry]                    |   | - Streaming SHA-256 Manifest Maker |
|         ^                              |   | - REST Endpoints for all Roles     |
|         | authorizes inspector/level   |   +------------------+-----------------+
| [LandRegistry] <-----> [TransferEscrow]|                      |
| (Parcel Truth)         (Payment Lock)  |                SQLAlchemy 2.0 /
+---------+--------------------+---------+                 GeoAlchemy2
          |                    |                                |
          +----------+---------+                                v
                     | Emits Events          +------------------------------------+
                     v                       |             DATA LAYER             |
         +-----------------------+           | PostgreSQL 16 + PostGIS 3.4        |
         |   EVENT INDEXER       |           | - `lands`, `transfers`, `escrows`  |
         | - Soft-confirmation   | Writes to | - `land_boundaries` (GIST Index)   |
         | - Idempotent Handler  |---------->| - `blockchain_events` (Unique log) |
         | - Reorg Reversal      |           |                                    |
         | - DB Role:            |           | MinIO S3 Object Storage            |
         |   `indexer_user` only |           | - Private Deeds & Survey Packages  |
         +-----------------------+           +------------------------------------+
```

---

## 4. Frozen Architectural Decisions (Settled for Phase 0)

1. **Contract Suite Structure:**
   - Standardized strictly on **4 specialized smart contracts**: `IdentityRegistry`, `InspectorRegistry`, `LandRegistry`, and `TransferEscrow`.
   - **No 5th `TransferManager` contract.** Coordination between transfers and land locks is handled directly via authorized callbacks between `LandRegistry` and `TransferEscrow`.
2. **Land Ownership Representation:**
   - In `LandRegistry.sol`, title ownership is anchored to `bytes32 ownerIdentityId` rather than a raw transient `address`.
   - The contract verifies `IdentityRegistry.getActiveWallet(ownerIdentityId) == msg.sender` on any owner transaction.
   - *Impact:* Seamless wallet loss and recovery without needing to reassign dozens of land titles individually.
3. **Escrow State Machine:**
   - `UNDER_REVIEW` is retained as an explicit state distinct from `FUNDED`.
   - Progression: `REQUESTED` $\rightarrow$ `FUNDED` $\rightarrow$ `UNDER_REVIEW` $\rightarrow$ `APPROVED` $\rightarrow$ `COMPLETED` (or failure paths: `CANCELLED` / `EXPIRED` / `REJECTED` $\rightarrow$ `REFUNDED`).
4. **Senior Inspector Approval Criteria:**
   - A secondary approval from a Senior Inspector (Level 2) is required if:
     - `agreedPrice >= 5 ETH`, OR
     - The parcel geometry triggered a Layer-2 spatial overlap flag during registration.
5. **Land Application Ingestion Policy:**
   - Draft applications remain **100% off-chain in PostgreSQL** until approved by field inspectors.
   - Only approved applications trigger the on-chain `registerLand()` transaction, preventing blockchain pollution and faucet gas wastage.
6. **Payment Disbursement Standard:**
   - Pull-payment architecture is enforced for both seller proceeds and buyer refunds via `withdrawFunds()`, preventing reentrancy and recipient revert denial-of-service.
7. **Indexer Confirmation Strategy:**
   - Two-tier block ingestion: soft confirmation at depth = 2 blocks for instant UI feedback, and finalized confirmation at depth = 32 blocks (or Sepolia finalized tag).
