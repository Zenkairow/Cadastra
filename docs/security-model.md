# Security Model & Threat Matrix (Phase 0 Freeze)

**Project:** Blockchain Land Registry  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Status:** Frozen v0.1  

---

## 1. Trust Boundaries & Principles
1. **Zero Key Custody:** The platform never generates, stores, transmits, or handles private keys. All blockchain transactions are signed locally by the user's web3 wallet (MetaMask).
2. **Zero PII On-Chain:** Aadhaar numbers, biometrics, phone numbers, or identity documents are never placed on-chain. Even hashing raw identity numbers on-chain is strictly forbidden to prevent rainbow-table correlation attacks.
3. **Immutability of Authoritative Land State:** Smart contracts decide ownership and authorization. The PostgreSQL database is a derived read-model; manual database tampering cannot alter blockchain truth and is rectified by automated reconciliation.
4. **Principle of Least Privilege in Storage & Database:**
   - Web application connects as `app_user` (strictly denied `INSERT`/`UPDATE` permissions on `lands`, `escrows`, and `blockchain_events`).
   - Only `indexer_user` can modify derived tables.
   - S3/MinIO buckets are private by default; access is granted only via short-lived presigned URLs (TTL $\le 15$ minutes).

---

## 2. STRIDE Threat & Mitigation Matrix

| Threat Category | Potential Attack Vector | Concrete Mitigation Enforced |
| :--- | :--- | :--- |
| **Spoofing** | Adversary replaying signed SIWE messages or using an unregistered wallet. | Single-use random nonces with 5-minute expiry tied to domain and Sepolia Chain ID (`11155111`). Smart contract queries `IdentityRegistry.isWalletActive()`. |
| **Tampering** | Modifying legal deed PDF stored in object storage or editing parcel geometry. | Document manifests are hashed (`SHA-256`) and anchored on-chain. PostGIS boundary geometries are canonically serialized and committed on-chain as `geometryHash`. |
| **Repudiation** | Inspector denying having approved a fraudulent land registration. | Inspector approvals are recorded permanently on-chain in `LandRegistry` emitting `LandVerified(landId, inspectorAddress)`. |
| **Information Disclosure** | Competitors scraping sensitive land deed PDFs or citizen identities. | PII stays in isolated KYC adapter. Documents reside in private S3 buckets accessible only via signed URLs after backend role/ownership verification. |
| **Denial of Service** | Malicious seller contract reverting on payment receipt to lock the escrow permanently. | Pull-payment pattern (`withdrawFunds()`) enforced in `TransferEscrow.sol`. Funds are credited to internal mapping; recipient must withdraw. |
| **Elevation of Privilege** | Field Inspector in Pune attempting to approve a property in Nashik. | Smart contracts strictly enforce jurisdiction containment: `require(inspector.jurisdictionId == land.jurisdictionId)` and verify `minLevel` in `InspectorRegistry`. |

---

## 3. Financial Escrow Guarantees
- **Exact Funding:** `require(msg.value == agreedPrice)` guarantees zero underpayment or overpayment locks.
- **Reentrancy Immunity:** All state modifications occur before balance adjustments or external calls (Checks-Effects-Interactions pattern), bolstered by OpenZeppelin's `ReentrancyGuard`.
- **Atomic Settlement:** Title reassignment in `LandRegistry` and payment release in `TransferEscrow` execute within the same atomic transaction frame.
