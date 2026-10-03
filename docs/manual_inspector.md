# Cadastra — Land Inspector & Senior Inspector Operations Manual

This manual provides an operational guide for certified Land Inspectors (Level 1) and Senior Inspectors (Level 2+) responsible for cadastral boundary audits, cryptographic deed verification, on-chain land approvals, and high-value transfer governance.

---

## 1. Inspector Role & Governance Architecture

Cadastra implements a hierarchical, jurisdiction-scoped governance model on Ethereum:

| Inspector Level | Role | Responsibilities | Max Escrow Governance |
| :--- | :--- | :--- | :--- |
| **Level 1** | Land Inspector | Initial land registration reviews, boundary inspection, deed verification, standard transfers. | Transfers $< 5.0$ ETH |
| **Level 2** | Senior Inspector | All Level 1 functions plus mandatory dual-approval for high-value escrow transfers ($\ge 5.0$ ETH). | Unlimited |
| **Level 3** | Regional Registrar | Administrative jurisdiction oversight, inspector onboarding, emergency revocation. | Administrative |

### 1.1 Strict Jurisdiction Scoping
Every inspector is bound to an immutable `jurisdictionId` on the `InspectorRegistry.sol` contract. 
- You can **only** inspect, approve, or reject land applications located strictly within your designated territorial jurisdiction.
- Any attempt to act outside your assigned jurisdiction will automatically revert on-chain (`InspectorNotAuthorized()`).

---

## 2. Accessing the Inspector Portal

1. Connect your authorized inspector wallet to the Cadastra application.
2. Sign the EIP-4361 authentication challenge in MetaMask.
3. The platform verifies your role against the live `InspectorRegistry` contract:
   - Validates that your status is `active == true`.
   - Checks that the block timestamp has not exceeded `validUntil`.
   - Identifies your assigned `jurisdictionId` and numeric role level.
4. If authorized, the **Inspector Review Console** will appear in the primary navigation.

---

## 3. Cadastral Application Review Queue

Navigate to **Review Queue** in the inspector dashboard:
- The queue displays all pending land registration applications (`SUBMITTED` or `UNDER_REVIEW`) within your jurisdiction.
- Critical metadata is summarized: Legal parcel identification, applicant identity ID, calculated surface area, submission timestamp, and pre-computed risk indicators.

Click **Review Application** to open the comprehensive inspection suite.

---

## 4. Geospatial Boundary & Overlap Inspection

The Cadastra Geospatial Inspection Engine integrates with PostGIS to provide rigorous spatial verification:

### 4.1 Boundary Geometry Validation
1. Inspect the visual polygon boundary rendered on the high-resolution cadastral map.
2. Check the geometric properties computed by the PostGIS engine:
   - **OGC Simple Polygon Validity:** Ensures no self-intersecting edges or complex loops.
   - **Geodesic Ellipsoidal Area:** Confirms surface area measured on WGS 84 (EPSG:4326) matches the official survey measurement within $\pm 0.5\%$ margin.
   - **Canonical Geometry Hash:** Verify the on-chain SHA-256 geometry commitment.

### 4.2 Layer 2 Spatial Overlap & Encroachment Detection
Cadastra employs a two-tier spatial conflict detection engine:
- **Shared Property Boundaries (Permitted):** Adjacent parcels with shared linear edges or border lines are identified with $0.0\%$ area overlap. These are highlighted in **Emerald Green**.
- **Encroachment & Duplicate Overlaps (Blocked):** If the polygon intersects any existing verified parcel by $\ge 0.01\%$, the engine flags a spatial conflict. The overlapping intersection polygon is rendered in **Crimson Red** with exact overlap percentage and conflicting parcel ID.

> [!CAUTION]
> Under administrative regulations, an inspector must never approve an application displaying an unresolvable crimson overlap conflict. If fraudulent overlap is detected, click **Reject Application** and specify the conflicting parcel ID.

---

## 5. Document Tamper Verification Lab

Cadastra guarantees that evidentiary documents (deeds, survey maps, approvals) stored in off-chain object storage (MinIO/S3) have not been altered or corrupted.

### 5.1 Real-Time Tamper Audit
1. Open the **Documents & Title Deeds** section of the inspection panel.
2. Click **Run Cryptographic Tamper Audit**.
3. The platform fetches the documents chunk-by-chunk and recalculates the SHA-256 hash for every file in the manifest.
4. It re-assembles the canonical manifest JSON and calculates the root `manifestHash`.
5. The computed hash is compared directly against the applicant's signed manifest commitment:
   - **Green Badge (`100% Tamper Free`):** All file hashes match the manifest root. The document integrity is verified.
   - **Red Alert (`CRYPTOGRAPHIC TAMPER DETECTED`):** Even a single bit or byte altered in storage produces an entirely different hash. The specific corrupted document and byte mismatch are isolated in the audit panel.

---

## 6. On-Chain Land Verification & Minting

Once boundary geometry, geodesic area, deed authenticity, and duplicate checks are successfully validated:

1. Click **Approve & Register Land on Blockchain**.
2. Review the final on-chain transaction parameters:
   - `parcelKey`: The deterministic keccak256 hash of the normalized legal identifier.
   - `jurisdictionId`: Your territorial jurisdiction code.
   - `geometryHash`: The canonical boundary hash.
   - `manifestHash`: The verified document manifest hash.
3. MetaMask will prompt you to sign the `verifyLand(...)` transaction calling `LandRegistry.sol`.
4. Upon transaction confirmation on Sepolia:
   - The land parcel is assigned an immutable on-chain `landId`.
   - The status transitions to `VERIFIED`.
   - The confirmation-aware indexer captures the `LandVerified` event and updates the PostgreSQL read model within milliseconds.
   - The parcel is immediately indexed on the public Cadastral Map.

---

## 7. Senior Inspector High-Value Escrow Governance

Transactions with a purchase price of **$\ge 5.0$ ETH** require mandatory dual-approval under the Cadastra Escrow State Machine.

### 7.1 Reviewing High-Value Transfers
1. Navigate to **Escrow Approvals** $\to$ **High-Value Queue ($\ge 5$ ETH)**.
2. Select the pending transfer request in state `AWAITING_SENIOR_APPROVAL`.
3. Verify the transaction parameters:
   - `transferId`, `landId`, agreed `depositAmount` (ETH).
   - Buyer identity and seller identity bindings.
   - Confirmation that the buyer's full deposit is locked in custody in the `TransferEscrow` contract balance.
4. Review the attached Deed of Conveyance and Sale Agreement.

### 7.2 Executing Senior Inspector Approval
1. Click **Authorize High-Value Escrow Transfer**.
2. MetaMask will prompt you to call `approveTransfer(transferId)` on `TransferEscrow.sol`.
3. The contract validates that your account is registered as a **Level 2+ Senior Inspector** in `InspectorRegistry.sol`.
4. The transfer state advances to `AWAITING_SETTLEMENT`, allowing the buyer or seller to finalize ownership settlement.
