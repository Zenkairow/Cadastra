# Cadastra — Citizen & Landowner User Manual

This manual provides a detailed operational guide for citizens, property buyers, and landowners using the Cadastra blockchain land registry platform.

---

## 1. Getting Started & Wallet Setup

### 1.1 Web3 Wallet Installation
1. Install the [MetaMask browser extension](https://metamask.io/) in Google Chrome, Brave, or Firefox.
2. Initialize or restore your Ethereum wallet account. Secure your 12-word seed phrase offline.

### 1.2 Network Configuration (Ethereum Sepolia)
Ensure your wallet is connected to the **Ethereum Sepolia Testnet**:
- **Network Name:** Sepolia Test Network
- **Chain ID:** `11155111` (Hex: `0xaa36a7`)
- **Currency Symbol:** `ETH`
- **RPC URL:** Alchemy, Infura, or public Sepolia RPC (`https://rpc.sepolia.org`)
- **Block Explorer:** `https://sepolia.etherscan.io`

Acquire testnet ETH from a Sepolia faucet (e.g. Alchemy Sepolia Faucet or Infura Faucet) to cover transaction gas fees.

---

## 2. Authentication & Identity Binding

Cadastra enforces a strict **Zero-PII Identity Binding** model. No government ID numbers (e.g., Aadhaar, SSN, PAN) are ever stored on-chain or in readable databases.

### 2.1 Sign-In With Ethereum (SIWE / EIP-4361)
1. Open the Cadastra web portal at `http://localhost:5173`.
2. Click **Connect Wallet** in the top right corner.
3. Accept the cryptographic signature challenge in MetaMask. The message follows the standard EIP-4361 format containing domain, wallet address, URI, issue timestamp, and a single-use anti-replay nonce.
4. Upon signature verification, a secure, short-lived JWT session is created.

### 2.2 KYC & Identity Activation
1. Navigate to the **Profile & Verification** tab.
2. If your wallet is unverified, submit an identity verification request.
3. An authorized platform registrar verifies your proof off-chain and executes `verifyAndBindIdentity(identityId, walletAddress)` on the `IdentityRegistry` smart contract.
4. Once verified, your wallet is immutably mapped to a pseudo-anonymous platform identity ID.

---

## 3. Registering a New Land Parcel

To register private land property:

### Step 1: Legal Parcel Information
1. Navigate to **Register Land** in the top navigation bar.
2. Fill in the standard cadastral hierarchy fields:
   - **Country & State:** e.g., India, Karnataka
   - **District:** e.g., Bengaluru Urban
   - **Taluk / Sub-District:** e.g., Bengaluru South
   - **Village / Ward:** e.g., Begur
   - **Survey Number:** e.g., `42/1A`
3. The platform computes a canonical Unicode NFKC string: `IN-KA-BLR-BG-42/1A`.
4. A unique `parcelKey = keccak256(canonicalString)` is generated to prevent duplicate registrations across the network.

### Step 2: Spatial Boundary Definition (Cadastral Map)
1. In the interactive geospatial editor, zoom to your property's physical location.
2. Click the **Polygon Drawing Tool** to trace the exact parcel boundary vertices.
3. The platform automatically validates the geometry:
   - Ensures polygon closure (first vertex equals last vertex).
   - Verifies vertices winding order and OGC simple-polygon validity.
   - Calculates geodesic ellipsoidal surface area on the WGS 84 ellipsoid (EPSG:4326).
   - Generates the rotation- and winding-invariant `geometryHash`.
4. The system automatically executes a **Layer 2 Pre-flight Spatial Overlap Check** against the PostGIS database. If encroachment or duplicate overlap is detected, an informative warning with intersection geometry is presented.

### Step 3: Evidentiary Document Upload
1. Upload authentic legal documentation (Title Deed, Cadastral Survey Map, Tax Receipts).
2. The browser streams the files chunk-by-chunk to calculate client-side cryptographic SHA-256 hashes without loading large files into memory.
3. A canonical manifest tree is assembled, yielding a single `documentManifestHash`.
4. Click **Submit Application**. Files are encrypted and uploaded to private S3/MinIO storage.
5. The application enters the **`SUBMITTED`** state awaiting assigned jurisdictional inspector review.

---

## 4. Tracking Application Status

Navigate to **My Applications** on the Citizen Dashboard:

| Status Badge | Meaning | Next Step |
| :--- | :--- | :--- |
| **`SUBMITTED`** | Application recorded off-chain; awaiting inspector assignment. | Inspector begins review. |
| **`UNDER_REVIEW`** | Assigned jurisdictional land inspector is validating boundary and deeds. | None; review in progress. |
| **`VERIFIED`** | Application approved; land minted on the Ethereum blockchain. | Parcel is now tradeable. |
| **`REJECTED`** | Application rejected due to boundary conflict or fraudulent deed. | View inspector audit notes. |

Once verified, the on-chain land ID and Etherscan transaction link are displayed.

---

## 5. Buying Land via Smart Contract Escrow

Cadastra features a secure, trustless **Transfer Escrow State Machine** to eliminate fraud and double-selling.

### 5.1 Initiating an Escrow Purchase Request
1. Search the **Public Cadastral Explorer** or select an existing verified land parcel.
2. Verify ownership, parcel boundaries, and title deed hashes.
3. Click **Initiate Escrow Purchase**.
4. Specify the agreed purchase price in ETH.
5. MetaMask will prompt you to confirm the `requestTransfer(landId, sellerWallet)` transaction on the `TransferEscrow.sol` contract.
6. The request is assigned a unique `transferId` in the `CREATED` state.

### 5.2 Depositing Escrow Funds
1. Navigate to the **Escrow Management** panel.
2. Select your active `transferId`.
3. Click **Deposit Escrow Funds**.
4. MetaMask prompts you to send the **exact ETH amount** matching the purchase price into the `TransferEscrow` contract via `fundEscrow(transferId)`.
5. The contract locks the funds in custody, transitioning the state to `FUNDED`.

> [!WARNING]
> The smart contract strictly enforces exact payment (`msg.value == depositAmount`). Overpayments or underpayments will automatically revert.

### 5.3 Seller Approval & High-Value Senior Approval
- The seller reviews and signs `approveSeller(transferId)`.
- If the transaction value is **$\ge 5.0$ ETH**, an authorized **Senior Inspector (Level 2+)** within the parcel's jurisdiction must conduct an independent title audit and execute `approveTransfer(transferId)`.
- Once all required approvals are registered on-chain, the status transitions to `AWAITING_SETTLEMENT`.

---

## 6. Settlement & Pull-Payment Withdrawal

### 6.1 Executing Ownership Settlement
1. Either the buyer, seller, or an authorized inspector calls `settleTransfer(transferId)`.
2. The `TransferEscrow` contract interacts atomically with `LandRegistry`:
   - Land ownership is transferred on-chain to the buyer.
   - Escrow state moves to `SETTLED`.
   - The deposit amount (minus optional platform fees) is credited to the seller's **pending pull-payment balance**.

### 6.2 Withdrawing Funds (Pull-Payment Pattern)
To protect against reentrancy attacks and malicious receiver contracts, Cadastra utilizes the **OpenZeppelin Pull-Payment Invariant**:
1. Navigate to the **Escrow Dashboard** $\to$ **Withdrawals**.
2. View your **Pending Available Balance**.
3. Click **Withdraw Funds**.
4. MetaMask prompts you to call `withdrawFunds()`.
5. The smart contract zeros your balance first (Checks-Effects-Interactions) and transfers the ETH directly to your wallet.
