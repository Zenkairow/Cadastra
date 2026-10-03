# Cadastra — Three-Scenario Demonstration Walkthrough Script

This document provides the authoritative, step-by-step demonstration script designed for viva examinations, technical reviews, and live evaluators. It demonstrates the complete end-to-end integration between the **React 18 Frontend**, **FastAPI Backend**, **PostGIS Spatial Engine**, **MinIO S3 Storage**, **Event Indexer**, and the **Ethereum Sepolia Smart Contracts**.

---

## Demonstration Setup & Test Accounts

Before beginning the demonstration, ensure the platform stack is running (`docker compose up -d`, `uvicorn backend.app.main:app`, `python -m backend.app.indexer.runner`, `npm run dev` in `frontend/`).

Prepare the following 4 pre-configured test wallets:

| Actor | Role | Assigned Address (Example) | Role Credentials |
| :--- | :--- | :--- | :--- |
| **Alice** | Citizen / Landowner | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | Verified Identity ID: `ID-ALICE-01` |
| **Bob** | Property Buyer | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | Verified Identity ID: `ID-BOB-02` |
| **Inspector Davis** | Land Inspector (Level 1) | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | Jurisdiction `1001` (Bengaluru Urban) |
| **Senior Sarah** | Senior Inspector (Level 2) | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | Jurisdiction `1001`, Level 2 Approval |

---

## Scenario 1: Legitimate Land Application, Inspection & On-Chain Minting

### Objective
Demonstrate the legitimate land registration lifecycle: cadastral boundary capture, client-side manifest hashing, jurisdictional inspector review, zero-overlap validation, on-chain minting on Sepolia, and real-time event synchronization.

### Step-by-Step Walkthrough

1. **Citizen Login & Identity Verification:**
   - In MetaMask, switch to **Alice's wallet**.
   - Navigate to `http://localhost:5173`.
   - Click **Connect Wallet** $\to$ Sign the EIP-4361 SIWE challenge.
   - Notice the status badge confirms Alice is verified with active platform identity `ID-ALICE-01`.

2. **Parcel Data & Geospatial Boundary Capture:**
   - Click **Register Land** in the top navigation.
   - Enter legal details:
     - **Jurisdiction:** `1001 (Bengaluru Urban)`
     - **Taluk / Village:** `Bengaluru South / Begur`
     - **Survey Number:** `42/1A`
   - In the interactive Leaflet map, use the **Polygon Drawing Tool** to draw a 4-vertex parcel boundary:
     - Point 1: `[12.8850, 77.6250]`
     - Point 2: `[12.8850, 77.6270]`
     - Point 3: `[12.8830, 77.6270]`
     - Point 4: `[12.8830, 77.6250]`
   - The map displays: **Calculated Geodesic Area: 44,281.42 m² (10.94 acres)**.
   - Pre-flight Layer 2 check confirms: **Zero Overlap Detected (Safe to register)**.

3. **Document Upload & Manifest Hashing:**
   - Upload sample deed `title_deed_begur.pdf` and survey `cadastral_survey_42_1a.pdf`.
   - The UI streams the files and computes:
     - File 1 SHA-256: `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`
     - File 2 SHA-256: `5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8`
     - **Canonical Manifest Hash:** `0x7b23f81...`
   - Click **Submit Application**. Files upload to MinIO; application status becomes **`SUBMITTED`**.

4. **Inspector Review & Multi-Tier Verification:**
   - Switch MetaMask to **Inspector Davis's wallet**.
   - Refresh the page $\to$ The **Inspector Review Console** appears.
   - Select Alice's application in the **Review Queue (Jurisdiction 1001)**.
   - Inspect the boundary: PostGIS confirms OGC Simple Polygon validity and 0.0% overlap with existing parcels.
   - Run the **Cryptographic Tamper Audit**: All files match the signed manifest (Green indicator).
   - Click **Approve & Mint on Blockchain**.
   - Confirm the transaction calling `verifyLand(...)` on Sepolia in MetaMask.

5. **Verification & Event Sync Confirmation:**
   - Transaction confirms in Block `N` on Sepolia (`https://sepolia.etherscan.io/tx/...`).
   - The indexer captures the `LandVerified` event in $< 0.8$ ms.
   - Switch back to the public **Cadastral Map**: Alice's parcel is rendered in **Emerald Green**, showing Owner `0x7099...79C8`, Land ID `#1`, Status `VERIFIED`.

---

## Scenario 2: Fraudulent Encroachment & Document Tamper Detection

### Objective
Demonstrate Cadastra's dual defenses against fraud: Layer 2 PostGIS spatial overlap detection and cryptographic tamper detection of evidentiary files.

### Step-by-Step Walkthrough

### Part A: Fraudulent Spatial Encroachment Rejection
1. Switch MetaMask to an adversarial wallet (e.g. `0x1111...1111`).
2. Navigate to **Register Land**.
3. Attempt to register an overlapping parcel (`Begur Survey 42/1B`) with coordinates intentionally intersecting Alice's verified parcel by 25%:
   - Point 1: `[12.8840, 77.6260]` (inside Alice's parcel)
   - Point 2: `[12.8840, 77.6280]`
   - Point 3: `[12.8820, 77.6280]`
   - Point 4: `[12.8820, 77.6260]`
4. Click **Validate Geometry**:
   - The PostGIS Layer 2 spatial duplicate engine executes an `ST_Intersects` and `ST_Intersection` query.
   - **Result:** The system triggers an immediate rejection (**HTTP 409 Conflict**).
   - **Visual Alert:** The conflicting intersection area is highlighted in **Crimson Red** on the map.
   - **Audit Detail:** `"Encroachment Detected: 25.14% area overlap with verified Parcel #1 (Owner: 0x7099...79C8). Registration blocked."`

### Part B: Evidentiary Document Tamper Lab
1. Switch to Inspector Davis's console.
2. In the background storage/demo lab, inject a single-byte corruption into a stored title deed PDF (`docs/benchmark_rq5_document_integrity.py` or MinIO console).
3. The inspector opens the document audit view and clicks **Run Cryptographic Tamper Audit**:
   - The engine streams the file and recalculates the SHA-256 hash.
   - **Result:** The computed hash mismatches the on-chain manifest hash commitment.
   - **Visual Alert:** A high-priority red alert flashes on screen:
     ```
     [!] CRYPTOGRAPHIC TAMPER DETECTED
     Expected Manifest Hash: 0x7b23f81...
     Calculated Manifest Hash: 0x8a11e42...
     File Corrupted: title_deed_begur.pdf (Byte mismatch detected)
     ```
   - Inspector clicks **Flag & Reject Application**; fraud incident is permanently logged to the audit trail.

---

## Scenario 3: Escrow Purchase, High-Value Approval & Pull Settlement

### Objective
Demonstrate trustless property transfer: exact payment enforcement, smart contract escrow custody, Senior Inspector dual-approval for high-value transactions ($\ge 5.0$ ETH), and reentrancy-safe pull-payment disbursement.

### Step-by-Step Walkthrough

1. **Buyer Initiates Escrow Purchase:**
   - Switch MetaMask to **Bob's wallet** (`0x3C44...93BC`).
   - Navigate to the **Cadastral Explorer** and select Alice's verified **Parcel #1**.
   - Click **Initiate Escrow Purchase**.
   - Input agreed purchase price: **`5.5 ETH`** (exceeding the 5.0 ETH high-value governance threshold).
   - Confirm transaction `requestTransfer(landId=1, seller=Alice)` in MetaMask.
   - Escrow request `#101` is created in state **`CREATED`**.

2. **Buyer Deposits Exact Escrow Funds:**
   - On the **Escrow Dashboard**, Bob clicks **Deposit Escrow Funds**.
   - MetaMask prompts Bob to deposit exactly **`5.5 ETH`**.
   - The `TransferEscrow.sol` contract confirms receipt, locking the ETH in contract custody.
   - Status transitions to **`FUNDED`**.

3. **Seller Acceptance & High-Value State Transition:**
   - Switch MetaMask to **Alice's wallet** (Seller).
   - Alice reviews Bob's offer on the Escrow Dashboard and clicks **Accept Purchase Offer**.
   - Transaction `approveSeller(transferId=101)` confirms on-chain.
   - Because the purchase amount (5.5 ETH) is $\ge 5.0$ ETH, the escrow state machine transitions to:
     **`AWAITING_SENIOR_APPROVAL`**.

4. **Senior Inspector Governance Approval:**
   - Switch MetaMask to **Senior Sarah's wallet** (`0x15d3...6A65`, Level 2 Senior Inspector).
   - Navigate to **Escrow Approvals** $\to$ **High-Value Queue ($\ge 5.0$ ETH)**.
   - Sarah reviews the deed of conveyance and confirms seller/buyer identity bindings.
   - Sarah clicks **Authorize High-Value Transfer**.
   - Transaction `approveTransfer(transferId=101)` confirms on Sepolia.
   - Escrow state advances to **`AWAITING_SETTLEMENT`**.

5. **Ownership Settlement:**
   - Either Bob (Buyer) or Alice (Seller) clicks **Execute Final Settlement**.
   - Transaction `settleTransfer(transferId=101)` calls `TransferEscrow.sol`:
     - Ownership of Parcel #1 is atomically updated from Alice to Bob in `LandRegistry.sol`.
     - 5.5 ETH is credited to Alice's internal pull-payment withdrawal ledger.
     - Escrow status is finalized to **`SETTLED`**.

6. **Pull-Payment Fund Withdrawal (Reentrancy Invariant):**
   - Switch to **Alice's wallet**.
   - Navigate to **Escrow Dashboard** $\to$ **Withdrawals**.
   - View pending available balance: **`5.5 ETH`**.
   - Alice clicks **Withdraw Funds to Wallet**.
   - Transaction calls `withdrawFunds()` on `TransferEscrow.sol`.
   - The contract sets Alice's balance to 0 first (Checks-Effects-Interactions) and transfers 5.5 ETH directly to Alice's wallet.
   - Contract balance decreases to 0; Alice's wallet receives the full proceeds.

---

## Conclusion of Demonstration
The three scenarios prove:
1. Complete integration from UI to database to Sepolia smart contracts.
2. 100% rejection of spatial encroachments and cryptographic document tamper.
3. Trustless, secure escrow settlement with senior administrative governance.
