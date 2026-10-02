// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title IdentityRegistry
 * @dev Enforces the invariant: Exactly 1 verified platform identity <-> 1 active wallet address.
 * Keeps all personally identifiable information (PII) off-chain; operates solely on opaque bytes32 identifiers.
 */
contract IdentityRegistry is AccessControlEnumerable, Pausable {
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");

    enum WalletStatus { NONE, ACTIVE, REVOKED }

    struct IdentityBinding {
        bytes32 identityId;
        address activeWallet;
        WalletStatus status;
        uint256 verifiedAt;
        uint256 updatedAt;
    }

    // Mapping from identityId (UUID hashed/converted to bytes32) to binding details
    mapping(bytes32 => IdentityBinding) private _identities;

    // Reverse mapping from wallet address to identityId
    mapping(address => bytes32) private _walletToIdentity;

    // Quick lookup for active wallet validity
    mapping(address => bool) private _activeWallets;

    // Events
    event IdentityBound(bytes32 indexed identityId, address indexed wallet, uint256 timestamp);
    event WalletRevoked(bytes32 indexed identityId, address indexed wallet, uint256 timestamp);
    event WalletRecovered(bytes32 indexed identityId, address indexed oldWallet, address indexed newWallet, uint256 timestamp);

    // Custom Errors
    error ZeroIdentityId();
    error ZeroAddress();
    error WalletAlreadyBound(address wallet);
    error IdentityAlreadyBound(bytes32 identityId);
    error IdentityNotFound(bytes32 identityId);
    error WalletMismatch(address expected, address actual);
    error WalletNotActive(address wallet);

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(KYC_ADMIN_ROLE, initialAdmin);
    }

    /**
     * @notice Verifies an identity and activates their designated wallet.
     * @param identityId Opaque platform identity identifier.
     * @param wallet Ethereum address to bind.
     */
    function verifyAndBindIdentity(bytes32 identityId, address wallet) external onlyRole(KYC_ADMIN_ROLE) whenNotPaused {
        if (identityId == bytes32(0)) revert ZeroIdentityId();
        if (wallet == address(0)) revert ZeroAddress();
        if (_walletToIdentity[wallet] != bytes32(0)) revert WalletAlreadyBound(wallet);
        if (_identities[identityId].status != WalletStatus.NONE) revert IdentityAlreadyBound(identityId);

        _identities[identityId] = IdentityBinding({
            identityId: identityId,
            activeWallet: wallet,
            status: WalletStatus.ACTIVE,
            verifiedAt: block.timestamp,
            updatedAt: block.timestamp
        });

        _walletToIdentity[wallet] = identityId;
        _activeWallets[wallet] = true;

        emit IdentityBound(identityId, wallet, block.timestamp);
    }

    /**
     * @notice Recovers a lost wallet for an identity after off-chain KYC re-verification.
     * @param identityId Opaque platform identity identifier.
     * @param oldWallet Wallet being replaced and revoked.
     * @param newWallet Fresh wallet address to bind as active.
     */
    function recoverWallet(
        bytes32 identityId,
        address oldWallet,
        address newWallet
    ) external onlyRole(KYC_ADMIN_ROLE) whenNotPaused {
        if (identityId == bytes32(0)) revert ZeroIdentityId();
        if (newWallet == address(0)) revert ZeroAddress();
        if (_walletToIdentity[newWallet] != bytes32(0)) revert WalletAlreadyBound(newWallet);

        IdentityBinding storage binding = _identities[identityId];
        if (binding.status == WalletStatus.NONE) revert IdentityNotFound(identityId);
        if (binding.activeWallet != oldWallet) revert WalletMismatch(binding.activeWallet, oldWallet);

        // Revoke old wallet
        _activeWallets[oldWallet] = false;

        // Activate new wallet
        binding.activeWallet = newWallet;
        binding.status = WalletStatus.ACTIVE;
        binding.updatedAt = block.timestamp;

        _walletToIdentity[newWallet] = identityId;
        _activeWallets[newWallet] = true;

        emit WalletRecovered(identityId, oldWallet, newWallet, block.timestamp);
    }

    /**
     * @notice Revokes a compromised or decommissioned wallet.
     * @param identityId Opaque platform identity identifier.
     * @param wallet Address to revoke.
     */
    function revokeWallet(bytes32 identityId, address wallet) external onlyRole(KYC_ADMIN_ROLE) whenNotPaused {
        IdentityBinding storage binding = _identities[identityId];
        if (binding.status == WalletStatus.NONE) revert IdentityNotFound(identityId);
        if (binding.activeWallet != wallet) revert WalletMismatch(binding.activeWallet, wallet);
        if (!_activeWallets[wallet]) revert WalletNotActive(wallet);

        _activeWallets[wallet] = false;
        binding.status = WalletStatus.REVOKED;
        binding.updatedAt = block.timestamp;

        emit WalletRevoked(identityId, wallet, block.timestamp);
    }

    /**
     * @notice Checks if a wallet is currently registered and active.
     */
    function isWalletActive(address wallet) public view returns (bool) {
        return _activeWallets[wallet];
    }

    /**
     * @notice Spec-compliant alias for isWalletActive.
     */
    function isVerified(address wallet) external view returns (bool) {
        return isWalletActive(wallet);
    }

    /**
     * @notice Retrieves identityId bound to a wallet address.
     */
    function getIdentityByWallet(address wallet) external view returns (bytes32) {
        return _walletToIdentity[wallet];
    }

    /**
     * @notice Retrieves the active wallet associated with an identityId.
     */
    function getActiveWalletByIdentity(bytes32 identityId) external view returns (address) {
        IdentityBinding memory binding = _identities[identityId];
        if (binding.status != WalletStatus.ACTIVE) {
            return address(0);
        }
        return binding.activeWallet;
    }

    /**
     * @notice Full record inspection for an identityId.
     */
    function getIdentityBinding(bytes32 identityId) external view returns (IdentityBinding memory) {
        return _identities[identityId];
    }

    /**
     * @notice Pause circuit breaker
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause circuit breaker
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
