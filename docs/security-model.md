# Security Model & Threat Matrix (Phase 9 Hardened)

**Project:** Blockchain Land Registry / Cadastra  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Status:** **Hardened Release Candidate (Phase 9 Verified / Milestone M5)**  

---

## 1. Trust Boundaries & Principles
1. **Zero Key Custody:** The platform never generates, stores, transmits, or handles private keys. All blockchain transactions are signed locally by the user's web3 wallet (MetaMask) on Ethereum Sepolia (`chain ID 11155111`).
2. **Zero PII On-Chain & In Derived Read-Models:** Aadhaar numbers, biometrics, phone numbers, or identity documents are never placed on-chain or in PostgreSQL/PostGIS. Even hashing raw identity numbers on-chain is strictly forbidden to prevent rainbow-table correlation attacks.
3. **Immutability of Authoritative Land State:** Smart contracts decide ownership and authorization. The PostgreSQL database is a derived read-model; manual database tampering cannot alter blockchain truth and is rectified by automated reconciliation.
4. **Principle of Least Privilege in Storage & Database:**
   - Web application connects as `app_user` (strictly denied `INSERT`/`UPDATE` permissions on `lands`, `escrows`, and `blockchain_events`).
   - Only `indexer_user` can modify derived tables.
   - S3/MinIO buckets are private by default; access is granted only via short-lived presigned URLs (TTL $\le 15$ minutes).
5. **Circuit Breakers & Emergency Stops:** All contracts implement OpenZeppelin `Pausable` controlled exclusively by `DEFAULT_ADMIN_ROLE` to halt state-changing operations during detected anomalies.

---

## 2. Refreshed STRIDE Threat & Mitigation Matrix

| Threat Category | Potential Attack Vector | Concrete Mitigation Enforced | Verification Test |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Adversary replaying signed SIWE messages or using an unregistered wallet. | Single-use random nonces with 5-minute expiry tied to domain and Sepolia Chain ID (`11155111`). Smart contract queries `IdentityRegistry.isWalletActive()`. | `test_jwt_session_expiry_and_replay_protection`, `IdentityRegistry.test.js` |
| **Tampering** | Modifying legal deed PDF stored in object storage or editing parcel geometry. | Document manifests are hashed (`SHA-256`) and anchored on-chain. PostGIS boundary geometries are canonically serialized and committed on-chain as `geometryHash`. | `test_documents.py`, `test_geospatial.py`, `LandRegistry.test.js` |
| **Repudiation** | Inspector denying having approved a fraudulent land registration. | Inspector approvals are recorded permanently on-chain in `LandRegistry` emitting `LandVerified(landId, inspectorAddress)`. | `InspectorRegistry.test.js`, `TransferEscrow.test.js` |
| **Information Disclosure** | Competitors scraping sensitive land deed PDFs or citizen identities. | PII stays in isolated KYC adapter. Documents reside in private S3 buckets accessible only via signed URLs after backend role/ownership verification. | `test_zero_pii_storage_invariant`, `test_documents.py` |
| **Denial of Service** | Malicious seller contract reverting on payment receipt or flooding endpoints. | Pull-payment pattern (`withdrawFunds()`) enforced in `TransferEscrow.sol`. In-memory sliding-window rate limiters (15 req/min auth, 20 req/min upload). | `REENT-01`, `DOS-01`, `test_rate_limiting_enforcement` |
| **Elevation of Privilege** | Field Inspector in Pune attempting to approve a property in Nashik. | Smart contracts strictly enforce jurisdiction containment: `require(inspector.jurisdictionId == land.jurisdictionId)` and verify `minLevel` in `InspectorRegistry`. | `SecurityHardening.test.js::ACM-01` to `ACM-08` |

---

## 3. Financial Escrow Guarantees
- **Exact Funding:** `require(msg.value == agreedPrice)` guarantees zero underpayment or overpayment locks (`NEG-03`, `TC02`, `TC03`).
- **Reentrancy Immunity:** All state modifications occur before balance adjustments or external calls (Checks-Effects-Interactions pattern), bolstered by OpenZeppelin's `ReentrancyGuard` (`REENT-01`).
- **Pull-Payment Pattern:** Direct transfer calls to sellers or buyers are strictly avoided. All disbursements credit internal `_pendingWithdrawals` mapping; recipients must claim via `withdrawFunds()`.
- **Atomic Settlement:** Title reassignment in `LandRegistry` and payment release in `TransferEscrow` execute within the same atomic transaction frame.
- **Contract Balance Invariant:** Formally verified: $\text{Balance} = \sum \text{Active Deposits} + \sum \text{Pending Withdrawals}$ (`INV-01`).

---

## 4. Input Sanitization & Anti-Abuse Controls
1. **Filename Sanitization:** All uploaded document names are filtered through `sanitize_filename()` stripping path traversal sequences (`..`), forward/backward slashes, null bytes (`\x00`), and non-printable control characters.
2. **Magic Byte Verification:** File payloads are verified using initial magic byte signatures (`%PDF-`, `\x89PNG`, `\xff\xd8\xff`, `PK\x03\x04`), neutralizing MIME spoofing attacks.
3. **Strict Size Quotas:** Enforced per document type (Deeds: 25 MB; GIS Packages: 500 MB).
4. **Rate Limiting:** Sliding-window counters limit requests per client IP to mitigate automated credential stuffing and resource exhaustion.
