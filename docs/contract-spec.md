# Smart Contract Specification (Phase 0 Freeze)

**Target:** Solidity `^0.8.24`  
**Dependencies:** OpenZeppelin Contracts v5 (`AccessControlEnumerable`, `ReentrancyGuard`, `Pausable`)  
**Network:** Ethereum Sepolia (`11155111`)  
**Status:** Frozen v0.1  

---

## 1. Overview of Contract Suite

The blockchain tier consists of four modular, single-responsibility contracts:
```
[ IdentityRegistry ] <--- [ InspectorRegistry ]
         ^                          ^
         | verifies identity        | verifies authority & jurisdiction
         +-----------+--------------+
                     |
             [ LandRegistry ] <=======> [ TransferEscrow ]
                (Authoritative              (Custody & 
                 Land State)                 Settlement)
```

---

## 2. `IdentityRegistry.sol`

### Responsibilities:
- Manage the binding between an opaque platform identity (`bytes32 identityId`) and one active Ethereum wallet address (`address activeWallet`).
- Enforce the invariant: Exactly 1 verified identity $\leftrightarrow$ 1 active wallet.
- Handle wallet loss and key recovery (revoking old wallet, activating replacement).

### Data Structures:
```solidity
enum WalletStatus { NONE, ACTIVE, REVOKED }

struct IdentityBinding {
    bytes32 identityId;
    address activeWallet;
    WalletStatus status;
    uint256 verifiedAt;
    uint256 updatedAt;
}
```

### Key Functions:
- `verifyAndBindIdentity(bytes32 identityId, address wallet) external onlyRole(KYC_ADMIN_ROLE)`
- `recoverWallet(bytes32 identityId, address oldWallet, address newWallet) external onlyRole(KYC_ADMIN_ROLE)`
- `revokeWallet(bytes32 identityId, address wallet) external onlyRole(KYC_ADMIN_ROLE)`
- `isWalletActive(address wallet) external view returns (bool)`
- `getIdentityByWallet(address wallet) external view returns (bytes32)`
- `getActiveWalletByIdentity(bytes32 identityId) external view returns (address)`

### Events:
- `IdentityBound(bytes32 indexed identityId, address indexed wallet, uint256 timestamp)`
- `WalletRevoked(bytes32 indexed identityId, address indexed wallet, uint256 timestamp)`
- `WalletRecovered(bytes32 indexed identityId, address indexed oldWallet, address indexed newWallet)`

---

## 3. `InspectorRegistry.sol`

### Responsibilities:
- Maintain hierarchical roles:
  - Level 0: System Admin
  - Level 1: Regional Registrar
  - Level 2: Senior Inspector
  - Level 3: Field Inspector
- Assign and enforce geographic containment: `jurisdictionId`.
- Track appointment validity periods (`validUntil`) and emergency revocations.

### Data Structures:
```solidity
struct Inspector {
    address wallet;
    uint8 level; // 0=Admin, 1=Registrar, 2=Senior, 3=Field
    uint256 jurisdictionId;
    bool active;
    uint256 validUntil;
}
```

### Key Functions:
- `addInspector(address wallet, uint8 level, uint256 jurisdictionId, uint256 validUntil) external`
- `revokeInspector(address wallet) external`
- `changeInspectorLevel(address wallet, uint8 newLevel) external`
- `isAuthorized(address wallet, uint256 jurisdictionId, uint8 minLevel) external view returns (bool)`

### Events:
- `InspectorAdded(address indexed wallet, uint8 level, uint256 indexed jurisdictionId, uint256 validUntil)`
- `InspectorRevoked(address indexed wallet, uint256 timestamp)`
- `InspectorLevelChanged(address indexed wallet, uint8 oldLevel, uint8 newLevel)`

---

## 4. `LandRegistry.sol`

### Responsibilities:
- Act as the authoritative ledger for land parcels and ownership.
- Enforce on-chain parcel uniqueness using `parcelKey = keccak256(canonicalIdentifier)`.
- Store cryptographic commitments: `geometryHash` (GeoJSON fingerprint) and `documentManifestHash` (SHA-256 of canonical documents list).
- Enforce jurisdiction-bounded inspector verification.

### Data Structures:
```solidity
enum LandStatus { PENDING_VERIFICATION, VERIFIED, LOCKED_IN_TRANSFER, REJECTED }

struct Land {
    uint256 landId;
    bytes32 parcelKey;
    bytes32 ownerIdentityId;
    uint256 jurisdictionId;
    LandStatus status;
    bytes32 geometryHash;
    bytes32 documentManifestHash;
    uint256 registeredAt;
    uint256 verifiedAt;
    uint256 activeTransferId; // 0 if not locked in transfer
}
```

### Key Functions:
- `registerLand(bytes32 parcelKey, bytes32 ownerIdentityId, uint256 jurisdictionId, bytes32 geometryHash, bytes32 manifestHash) external returns (uint256)`
- `verifyLand(uint256 landId) external`
- `lockForTransfer(uint256 landId, uint256 transferId) external onlyEscrowContract`
- `unlockFromTransfer(uint256 landId) external onlyEscrowContract`
- `executeOwnershipTransfer(uint256 landId, bytes32 newOwnerIdentityId) external onlyEscrowContract`
- `getLand(uint256 landId) external view returns (Land memory)`
- `isParcelRegistered(bytes32 parcelKey) external view returns (bool)`

### Events:
- `LandRegistered(uint256 indexed landId, bytes32 indexed parcelKey, bytes32 indexed ownerIdentityId, uint256 jurisdictionId, bytes32 geometryHash, bytes32 manifestHash)`
- `LandVerified(uint256 indexed landId, address indexed inspector, uint256 timestamp)`
- `LandRejected(uint256 indexed landId, address indexed inspector, string reason)`
- `OwnershipTransferred(uint256 indexed landId, bytes32 indexed previousOwner, bytes32 indexed newOwner, uint256 timestamp)`

---

## 5. `TransferEscrow.sol`

### Responsibilities:
- Financial custody of buyer funds during property acquisition.
- Enforce exact payment: `require(msg.value == agreedPrice)`.
- Multi-inspector approval collection before settlement.
- Safe pull-payments for both seller payouts and buyer refunds.

### Data Structures:
```solidity
enum EscrowState { REQUESTED, FUNDED, UNDER_REVIEW, APPROVED, COMPLETED, CANCELLED, REJECTED, EXPIRED, REFUNDED }

struct EscrowRequest {
    uint256 requestId;
    uint256 landId;
    bytes32 buyerIdentityId;
    bytes32 sellerIdentityId;
    uint256 agreedPrice;
    uint256 depositAmount;
    uint256 expiresAt;
    EscrowState state;
    uint8 approvalCount;
    bool hasSeniorApproval;
}
```

### Key Functions:
- `requestTransfer(uint256 landId, bytes32 buyerIdentityId, uint256 price, uint256 duration) external returns (uint256)`
- `fundEscrow(uint256 requestId) external payable`
- `reviewTransfer(uint256 requestId) external`
- `approveTransfer(uint256 requestId) external`
- `settleTransfer(uint256 requestId) external nonReentrant`
- `cancelRequest(uint256 requestId) external`
- `refundBuyer(uint256 requestId) external nonReentrant`
- `withdrawFunds() external nonReentrant`

### Events:
- `TransferRequested(uint256 indexed requestId, uint256 indexed landId, bytes32 indexed buyerIdentityId, uint256 price)`
- `EscrowFunded(uint256 indexed requestId, uint256 amount, uint256 timestamp)`
- `TransferUnderReview(uint256 indexed requestId, address indexed inspector)`
- `TransferApproved(uint256 indexed requestId, address indexed inspector, uint8 level)`
- `EscrowSettled(uint256 indexed requestId, uint256 amount)`
- `RefundProcessed(uint256 indexed requestId, bytes32 indexed recipientIdentityId, uint256 amount)`
- `FundsWithdrawn(address indexed recipient, uint256 amount)`
