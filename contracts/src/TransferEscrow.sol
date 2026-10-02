// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IdentityRegistry.sol";
import "./InspectorRegistry.sol";
import "./LandRegistry.sol";

/**
 * @title TransferEscrow
 * @dev Secure financial escrow for land ownership transfers.
 * Enforces exact deposits, jurisdiction-bounded multi-tier inspector approvals,
 * atomic settlement with LandRegistry, and pull-payments for all fund releases and refunds.
 */
contract TransferEscrow is AccessControlEnumerable, Pausable, ReentrancyGuard {
    enum EscrowState {
        REQUESTED,
        FUNDED,
        UNDER_REVIEW,
        APPROVED,
        COMPLETED,
        CANCELLED,
        REJECTED,
        EXPIRED
    }

    struct EscrowRequest {
        uint256 requestId;
        uint256 landId;
        bytes32 buyerIdentityId;
        bytes32 sellerIdentityId;
        uint256 agreedPrice;
        uint256 depositAmount;
        uint256 createdAt;
        uint256 expiresAt;
        EscrowState state;
        uint8 approvalCount;
        bool hasSeniorApproval;
    }

    IdentityRegistry public immutable identityRegistry;
    InspectorRegistry public immutable inspectorRegistry;
    LandRegistry public immutable landRegistry;

    uint256 public constant HIGH_VALUE_THRESHOLD = 5 ether;

    uint256 private _nextRequestId = 1;

    mapping(uint256 => EscrowRequest) private _requests;
    mapping(uint256 => mapping(address => bool)) private _inspectorApprovals;

    // Pull-Payment balances: recipient address => claimable ETH
    mapping(address => uint256) private _pendingWithdrawals;

    // Events
    event TransferRequested(
        uint256 indexed requestId,
        uint256 indexed landId,
        bytes32 indexed buyerIdentityId,
        bytes32 sellerIdentityId,
        uint256 agreedPrice,
        uint256 expiresAt,
        uint256 timestamp
    );
    event EscrowFunded(uint256 indexed requestId, address indexed buyerWallet, uint256 amount, uint256 timestamp);
    event TransferUnderReview(uint256 indexed requestId, address indexed inspector, uint256 timestamp);
    event TransferApproved(uint256 indexed requestId, address indexed inspector, uint8 level, uint256 timestamp);
    event TransferRejected(uint256 indexed requestId, address indexed inspector, string reason, uint256 timestamp);
    event TransferSettled(
        uint256 indexed requestId,
        uint256 indexed landId,
        bytes32 indexed buyerIdentityId,
        bytes32 sellerIdentityId,
        uint256 amount,
        uint256 timestamp
    );
    event TransferCancelled(uint256 indexed requestId, uint256 timestamp);
    event TransferExpired(uint256 indexed requestId, uint256 timestamp);
    event RefundCredited(uint256 indexed requestId, address indexed buyerWallet, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(address indexed recipient, uint256 amount, uint256 timestamp);

    // Custom Errors
    error ZeroAddress();
    error ZeroAmount();
    error RequestNotFound(uint256 requestId);
    error InvalidState(uint256 requestId, EscrowState currentState);
    error NotBuyer(address caller, uint256 requestId);
    error NotSeller(address caller, uint256 requestId);
    error IncorrectFundingAmount(uint256 expected, uint256 provided);
    error UnauthorizedInspector(address inspector, uint256 jurisdictionId);
    error InspectorAlreadyApproved(uint256 requestId, address inspector);
    error TransferNotExpired(uint256 requestId, uint256 expiresAt, uint256 currentTime);
    error TransferAlreadyExpired(uint256 requestId, uint256 expiresAt, uint256 currentTime);
    error SeniorApprovalRequired(uint256 requestId);
    error SellerOwnershipChanged(uint256 landId, bytes32 expectedSeller, bytes32 actualSeller);
    error NoPendingWithdrawal(address caller);
    error WithdrawalFailed(address recipient, uint256 amount);

    constructor(
        address initialAdmin,
        address _identityRegistry,
        address _inspectorRegistry,
        address _landRegistry
    ) {
        if (
            initialAdmin == address(0) ||
            _identityRegistry == address(0) ||
            _inspectorRegistry == address(0) ||
            _landRegistry == address(0)
        ) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        identityRegistry = IdentityRegistry(_identityRegistry);
        inspectorRegistry = InspectorRegistry(_inspectorRegistry);
        landRegistry = LandRegistry(_landRegistry);
    }

    /**
     * @notice Initiates a transfer escrow request for a verified property.
     * Locks the land parcel on LandRegistry to prevent competing requests.
     */
    function requestTransfer(
        uint256 landId,
        bytes32 buyerIdentityId,
        uint256 agreedPrice,
        uint256 durationInSeconds
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (agreedPrice == 0) revert ZeroAmount();

        // Caller must be the active wallet for buyerIdentityId
        address activeBuyerWallet = identityRegistry.getActiveWalletByIdentity(buyerIdentityId);
        if (activeBuyerWallet == address(0) || activeBuyerWallet != msg.sender) {
            revert NotBuyer(msg.sender, 0);
        }

        LandRegistry.Land memory land = landRegistry.getLand(landId);
        if (land.landId == 0) revert RequestNotFound(landId);
        if (land.status != LandRegistry.LandStatus.VERIFIED) {
            revert InvalidState(landId, EscrowState.REQUESTED);
        }

        uint256 requestId = _nextRequestId++;
        uint256 expiresAt = block.timestamp + durationInSeconds;

        _requests[requestId] = EscrowRequest({
            requestId: requestId,
            landId: landId,
            buyerIdentityId: buyerIdentityId,
            sellerIdentityId: land.ownerIdentityId,
            agreedPrice: agreedPrice,
            depositAmount: 0,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            state: EscrowState.REQUESTED,
            approvalCount: 0,
            hasSeniorApproval: false
        });

        // Lock the land parcel on LandRegistry
        landRegistry.lockForTransfer(landId, requestId);

        emit TransferRequested(
            requestId,
            landId,
            buyerIdentityId,
            land.ownerIdentityId,
            agreedPrice,
            expiresAt,
            block.timestamp
        );

        return requestId;
    }

    /**
     * @notice Buyer deposits exact purchase price into escrow lockbox.
     * Strict exact-payment rule: underpayment and overpayment revert.
     */
    function fundEscrow(uint256 requestId) external payable whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (request.state != EscrowState.REQUESTED) revert InvalidState(requestId, request.state);
        if (block.timestamp > request.expiresAt) revert TransferAlreadyExpired(requestId, request.expiresAt, block.timestamp);

        address buyerWallet = identityRegistry.getActiveWalletByIdentity(request.buyerIdentityId);
        if (msg.sender != buyerWallet) revert NotBuyer(msg.sender, requestId);

        if (msg.value != request.agreedPrice) {
            revert IncorrectFundingAmount(request.agreedPrice, msg.value);
        }

        request.depositAmount = msg.value;
        request.state = EscrowState.FUNDED;

        emit EscrowFunded(requestId, msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Inspector moves funded transfer to UNDER_REVIEW during field / legal check.
     */
    function reviewTransfer(uint256 requestId) external whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (request.state != EscrowState.FUNDED) revert InvalidState(requestId, request.state);

        LandRegistry.Land memory land = landRegistry.getLand(request.landId);
        if (!inspectorRegistry.isAuthorized(msg.sender, land.jurisdictionId, inspectorRegistry.LEVEL_FIELD_INSPECTOR())) {
            revert UnauthorizedInspector(msg.sender, land.jurisdictionId);
        }

        request.state = EscrowState.UNDER_REVIEW;
        emit TransferUnderReview(requestId, msg.sender, block.timestamp);
    }

    /**
     * @notice Inspector approves transfer. High-value transfers require Senior Inspector (Level 2).
     */
    function approveTransfer(uint256 requestId) external whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (request.state != EscrowState.FUNDED && request.state != EscrowState.UNDER_REVIEW) {
            revert InvalidState(requestId, request.state);
        }
        if (block.timestamp > request.expiresAt) revert TransferAlreadyExpired(requestId, request.expiresAt, block.timestamp);

        LandRegistry.Land memory land = landRegistry.getLand(request.landId);
        if (!inspectorRegistry.isAuthorized(msg.sender, land.jurisdictionId, inspectorRegistry.LEVEL_FIELD_INSPECTOR())) {
            revert UnauthorizedInspector(msg.sender, land.jurisdictionId);
        }

        if (_inspectorApprovals[requestId][msg.sender]) {
            revert InspectorAlreadyApproved(requestId, msg.sender);
        }

        _inspectorApprovals[requestId][msg.sender] = true;
        request.approvalCount += 1;

        InspectorRegistry.Inspector memory ins = inspectorRegistry.getInspector(msg.sender);
        if (ins.level <= inspectorRegistry.LEVEL_SENIOR_INSPECTOR()) {
            request.hasSeniorApproval = true;
        }

        emit TransferApproved(requestId, msg.sender, ins.level, block.timestamp);

        // Check if approvals satisfy requirements
        if (request.agreedPrice >= HIGH_VALUE_THRESHOLD) {
            // High value: requires at least 2 approvals AND one Senior Inspector
            if (request.approvalCount >= 2 && request.hasSeniorApproval) {
                request.state = EscrowState.APPROVED;
            }
        } else {
            // Standard value: 1 authorized Field Inspector approval is sufficient
            if (request.approvalCount >= 1) {
                request.state = EscrowState.APPROVED;
            }
        }
    }

    /**
     * @notice Inspector rejects transfer request. Credits refund to buyer and unlocks land.
     */
    function rejectTransfer(uint256 requestId, string calldata reason) external whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (request.state != EscrowState.FUNDED && request.state != EscrowState.UNDER_REVIEW) {
            revert InvalidState(requestId, request.state);
        }

        LandRegistry.Land memory land = landRegistry.getLand(request.landId);
        if (!inspectorRegistry.isAuthorized(msg.sender, land.jurisdictionId, inspectorRegistry.LEVEL_FIELD_INSPECTOR())) {
            revert UnauthorizedInspector(msg.sender, land.jurisdictionId);
        }

        request.state = EscrowState.REJECTED;

        // Unlock land parcel
        landRegistry.unlockFromTransfer(request.landId);

        // Credit refund to buyer via pull-payment
        address buyerWallet = identityRegistry.getActiveWalletByIdentity(request.buyerIdentityId);
        if (request.depositAmount > 0) {
            uint256 refundAmount = request.depositAmount;
            request.depositAmount = 0;
            _pendingWithdrawals[buyerWallet] += refundAmount;
            emit RefundCredited(requestId, buyerWallet, refundAmount, block.timestamp);
        }

        emit TransferRejected(requestId, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Settles approved transfer atomically.
     * Re-checks seller ownership, updates title to buyer, credits seller payment.
     */
    function settleTransfer(uint256 requestId) external whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (request.state != EscrowState.APPROVED) revert InvalidState(requestId, request.state);

        LandRegistry.Land memory land = landRegistry.getLand(request.landId);

        // Security check: verify seller is still the owner
        if (land.ownerIdentityId != request.sellerIdentityId) {
            revert SellerOwnershipChanged(request.landId, request.sellerIdentityId, land.ownerIdentityId);
        }

        if (request.agreedPrice >= HIGH_VALUE_THRESHOLD && !request.hasSeniorApproval) {
            revert SeniorApprovalRequired(requestId);
        }

        request.state = EscrowState.COMPLETED;
        uint256 paymentAmount = request.depositAmount;
        request.depositAmount = 0;

        // 1. Atomic title transfer in LandRegistry
        landRegistry.executeOwnershipTransfer(request.landId, request.buyerIdentityId);

        // 2. Credit seller proceeds via pull-payment
        address sellerWallet = identityRegistry.getActiveWalletByIdentity(request.sellerIdentityId);
        _pendingWithdrawals[sellerWallet] += paymentAmount;

        emit TransferSettled(
            requestId,
            request.landId,
            request.buyerIdentityId,
            request.sellerIdentityId,
            paymentAmount,
            block.timestamp
        );
    }

    /**
     * @notice Buyer cancels request before funding. Unlocks land.
     */
    function cancelRequest(uint256 requestId) external whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (request.state != EscrowState.REQUESTED) revert InvalidState(requestId, request.state);

        address buyerWallet = identityRegistry.getActiveWalletByIdentity(request.buyerIdentityId);
        if (msg.sender != buyerWallet) revert NotBuyer(msg.sender, requestId);

        request.state = EscrowState.CANCELLED;
        landRegistry.unlockFromTransfer(request.landId);

        emit TransferCancelled(requestId, block.timestamp);
    }

    /**
     * @notice Handles expired requests. Can be triggered by anyone if deadline has passed and not settled.
     * Unlocks land and credits refund to buyer.
     */
    function refundExpiredRequest(uint256 requestId) external whenNotPaused nonReentrant {
        EscrowRequest storage request = _requests[requestId];
        if (request.requestId == 0) revert RequestNotFound(requestId);
        if (
            request.state == EscrowState.COMPLETED ||
            request.state == EscrowState.CANCELLED ||
            request.state == EscrowState.REJECTED ||
            request.state == EscrowState.EXPIRED
        ) {
            revert InvalidState(requestId, request.state);
        }

        if (block.timestamp <= request.expiresAt) {
            revert TransferNotExpired(requestId, request.expiresAt, block.timestamp);
        }

        request.state = EscrowState.EXPIRED;
        landRegistry.unlockFromTransfer(request.landId);

        if (request.depositAmount > 0) {
            uint256 refundAmount = request.depositAmount;
            request.depositAmount = 0;
            address buyerWallet = identityRegistry.getActiveWalletByIdentity(request.buyerIdentityId);
            _pendingWithdrawals[buyerWallet] += refundAmount;
            emit RefundCredited(requestId, buyerWallet, refundAmount, block.timestamp);
        }

        emit TransferExpired(requestId, block.timestamp);
    }

    /**
     * @notice Pull-Payment pattern: users withdraw credited proceeds or refunds.
     * Protects contract against reentrancy and denial-of-service from reverting recipient wallets.
     */
    function withdrawFunds() external nonReentrant {
        uint256 amount = _pendingWithdrawals[msg.sender];
        if (amount == 0) revert NoPendingWithdrawal(msg.sender);

        _pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert WithdrawalFailed(msg.sender, amount);

        emit FundsWithdrawn(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Check pending withdrawal balance for a wallet.
     */
    function getPendingWithdrawal(address wallet) external view returns (uint256) {
        return _pendingWithdrawals[wallet];
    }

    /**
     * @notice Inspect full escrow request.
     */
    function getRequest(uint256 requestId) external view returns (EscrowRequest memory) {
        return _requests[requestId];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
