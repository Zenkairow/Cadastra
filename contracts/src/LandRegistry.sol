// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IdentityRegistry.sol";
import "./InspectorRegistry.sol";

/**
 * @title LandRegistry
 * @dev Authoritative land title registry with cryptographic parcel uniqueness,
 * off-chain commit anchors (geometryHash & manifestHash), jurisdiction-bounded
 * inspector verification, and escrow settlement hooks.
 */
contract LandRegistry is AccessControlEnumerable, Pausable, ReentrancyGuard {
    enum LandStatus {
        PENDING_VERIFICATION,
        VERIFIED,
        LOCKED_IN_TRANSFER,
        REJECTED
    }

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
        uint256 activeTransferId;
    }

    IdentityRegistry public immutable identityRegistry;
    InspectorRegistry public immutable inspectorRegistry;

    address public escrowContract;

    uint256 private _nextLandId = 1;

    mapping(uint256 => Land) private _lands;
    mapping(bytes32 => bool) private _parcelExists;
    mapping(bytes32 => uint256) private _parcelKeyToLandId;

    // Track inspector approvals per land: landId => (inspectorAddress => approved)
    mapping(uint256 => mapping(address => bool)) private _inspectorApprovals;
    mapping(uint256 => uint8) private _approvalCount;

    // Events
    event LandRegistered(
        uint256 indexed landId,
        bytes32 indexed parcelKey,
        bytes32 indexed ownerIdentityId,
        uint256 jurisdictionId,
        bytes32 geometryHash,
        bytes32 documentManifestHash,
        uint256 timestamp
    );
    event LandVerified(uint256 indexed landId, address indexed inspector, uint256 timestamp);
    event LandRejected(uint256 indexed landId, address indexed inspector, string reason, uint256 timestamp);
    event LandLockedForTransfer(uint256 indexed landId, uint256 indexed transferId, uint256 timestamp);
    event LandUnlockedFromTransfer(uint256 indexed landId, uint256 indexed transferId, uint256 timestamp);
    event OwnershipTransferred(
        uint256 indexed landId,
        bytes32 indexed previousOwner,
        bytes32 indexed newOwner,
        uint256 timestamp
    );
    event EscrowContractUpdated(address indexed previousEscrow, address indexed newEscrow);

    // Custom Errors
    error ZeroAddress();
    error ZeroBytes32();
    error DuplicateParcelKey(bytes32 parcelKey);
    error OwnerNotVerified(bytes32 ownerIdentityId);
    error UnauthorizedInspector(address inspector, uint256 jurisdictionId);
    error LandNotFound(uint256 landId);
    error InvalidLandStatus(uint256 landId, LandStatus currentStatus);
    error OnlyEscrowAllowed(address caller);
    error InspectorAlreadyApproved(uint256 landId, address inspector);
    error NotLandOwner(address caller, uint256 landId);

    modifier onlyEscrow() {
        if (msg.sender != escrowContract) revert OnlyEscrowAllowed(msg.sender);
        _;
    }

    constructor(
        address initialAdmin,
        address _identityRegistry,
        address _inspectorRegistry
    ) {
        if (initialAdmin == address(0) || _identityRegistry == address(0) || _inspectorRegistry == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        identityRegistry = IdentityRegistry(_identityRegistry);
        inspectorRegistry = InspectorRegistry(_inspectorRegistry);
    }

    /**
     * @notice Designates the authorized TransferEscrow contract.
     */
    function setEscrowContract(address _escrowContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_escrowContract == address(0)) revert ZeroAddress();
        address oldEscrow = escrowContract;
        escrowContract = _escrowContract;
        emit EscrowContractUpdated(oldEscrow, _escrowContract);
    }

    /**
     * @notice Registers a new land record on-chain after off-chain application approval.
     * Enforces Layer 1 exact parcelKey uniqueness.
     */
    function registerLand(
        bytes32 parcelKey,
        bytes32 ownerIdentityId,
        uint256 jurisdictionId,
        bytes32 geometryHash,
        bytes32 documentManifestHash
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (parcelKey == bytes32(0) || ownerIdentityId == bytes32(0) || geometryHash == bytes32(0) || documentManifestHash == bytes32(0)) {
            revert ZeroBytes32();
        }

        // Layer 1: Strict on-chain duplicate parcelKey check
        if (_parcelExists[parcelKey]) {
            revert DuplicateParcelKey(parcelKey);
        }

        // Owner identity must be verified with an active wallet in IdentityRegistry
        if (identityRegistry.getActiveWalletByIdentity(ownerIdentityId) == address(0)) {
            revert OwnerNotVerified(ownerIdentityId);
        }

        // Caller must be an authorized inspector or registrar for this jurisdiction (or global admin)
        if (!inspectorRegistry.isAuthorized(msg.sender, jurisdictionId, inspectorRegistry.LEVEL_FIELD_INSPECTOR())) {
            revert UnauthorizedInspector(msg.sender, jurisdictionId);
        }

        uint256 landId = _nextLandId++;

        _lands[landId] = Land({
            landId: landId,
            parcelKey: parcelKey,
            ownerIdentityId: ownerIdentityId,
            jurisdictionId: jurisdictionId,
            status: LandStatus.PENDING_VERIFICATION,
            geometryHash: geometryHash,
            documentManifestHash: documentManifestHash,
            registeredAt: block.timestamp,
            verifiedAt: 0,
            activeTransferId: 0
        });

        _parcelExists[parcelKey] = true;
        _parcelKeyToLandId[parcelKey] = landId;

        emit LandRegistered(
            landId,
            parcelKey,
            ownerIdentityId,
            jurisdictionId,
            geometryHash,
            documentManifestHash,
            block.timestamp
        );

        return landId;
    }

    /**
     * @notice Inspector verifies a pending land record within their assigned jurisdiction.
     */
    function verifyLand(uint256 landId) external whenNotPaused nonReentrant {
        Land storage land = _lands[landId];
        if (land.landId == 0) revert LandNotFound(landId);
        if (land.status != LandStatus.PENDING_VERIFICATION) revert InvalidLandStatus(landId, land.status);

        if (!inspectorRegistry.isAuthorized(msg.sender, land.jurisdictionId, inspectorRegistry.LEVEL_FIELD_INSPECTOR())) {
            revert UnauthorizedInspector(msg.sender, land.jurisdictionId);
        }

        if (_inspectorApprovals[landId][msg.sender]) {
            revert InspectorAlreadyApproved(landId, msg.sender);
        }

        _inspectorApprovals[landId][msg.sender] = true;
        _approvalCount[landId] += 1;

        // Transition to VERIFIED once approved by authorized inspector
        land.status = LandStatus.VERIFIED;
        land.verifiedAt = block.timestamp;

        emit LandVerified(landId, msg.sender, block.timestamp);
    }

    /**
     * @notice Inspector rejects a pending land record.
     */
    function rejectLand(uint256 landId, string calldata reason) external whenNotPaused nonReentrant {
        Land storage land = _lands[landId];
        if (land.landId == 0) revert LandNotFound(landId);
        if (land.status != LandStatus.PENDING_VERIFICATION) revert InvalidLandStatus(landId, land.status);

        if (!inspectorRegistry.isAuthorized(msg.sender, land.jurisdictionId, inspectorRegistry.LEVEL_FIELD_INSPECTOR())) {
            revert UnauthorizedInspector(msg.sender, land.jurisdictionId);
        }

        land.status = LandStatus.REJECTED;

        emit LandRejected(landId, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Locks a verified land parcel during an active escrow transfer.
     * Prevents competing purchase requests or double-selling.
     */
    function lockForTransfer(uint256 landId, uint256 transferId) external onlyEscrow whenNotPaused {
        Land storage land = _lands[landId];
        if (land.landId == 0) revert LandNotFound(landId);
        if (land.status != LandStatus.VERIFIED) revert InvalidLandStatus(landId, land.status);

        land.status = LandStatus.LOCKED_IN_TRANSFER;
        land.activeTransferId = transferId;

        emit LandLockedForTransfer(landId, transferId, block.timestamp);
    }

    /**
     * @notice Unlocks a land parcel if an escrow request is cancelled, expired, or rejected.
     */
    function unlockFromTransfer(uint256 landId) external onlyEscrow whenNotPaused {
        Land storage land = _lands[landId];
        if (land.landId == 0) revert LandNotFound(landId);
        if (land.status != LandStatus.LOCKED_IN_TRANSFER) revert InvalidLandStatus(landId, land.status);

        uint256 prevTransferId = land.activeTransferId;
        land.status = LandStatus.VERIFIED;
        land.activeTransferId = 0;

        emit LandUnlockedFromTransfer(landId, prevTransferId, block.timestamp);
    }

    /**
     * @notice Executes atomic ownership transfer upon escrow settlement.
     */
    function executeOwnershipTransfer(uint256 landId, bytes32 newOwnerIdentityId) external onlyEscrow whenNotPaused {
        if (newOwnerIdentityId == bytes32(0)) revert ZeroBytes32();
        if (identityRegistry.getActiveWalletByIdentity(newOwnerIdentityId) == address(0)) {
            revert OwnerNotVerified(newOwnerIdentityId);
        }

        Land storage land = _lands[landId];
        if (land.landId == 0) revert LandNotFound(landId);
        if (land.status != LandStatus.LOCKED_IN_TRANSFER) revert InvalidLandStatus(landId, land.status);

        bytes32 previousOwner = land.ownerIdentityId;
        land.ownerIdentityId = newOwnerIdentityId;
        land.status = LandStatus.VERIFIED;
        land.activeTransferId = 0;

        emit OwnershipTransferred(landId, previousOwner, newOwnerIdentityId, block.timestamp);
    }

    /**
     * @notice Validates whether a caller's active wallet belongs to the registered land owner.
     */
    function isCallerLandOwner(uint256 landId, address caller) external view returns (bool) {
        Land memory land = _lands[landId];
        if (land.landId == 0) return false;
        return identityRegistry.getActiveWalletByIdentity(land.ownerIdentityId) == caller;
    }

    /**
     * @notice Retrieves full land record by landId.
     */
    function getLand(uint256 landId) external view returns (Land memory) {
        return _lands[landId];
    }

    /**
     * @notice Checks if a parcelKey has already been registered on-chain.
     */
    function isParcelRegistered(bytes32 parcelKey) external view returns (bool) {
        return _parcelExists[parcelKey];
    }

    /**
     * @notice Retrieves landId from parcelKey.
     */
    function getLandIdByParcelKey(bytes32 parcelKey) external view returns (uint256) {
        return _parcelKeyToLandId[parcelKey];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
