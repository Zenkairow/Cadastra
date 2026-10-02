// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title InspectorRegistry
 * @dev Enforces multi-tier inspector governance with jurisdiction containment.
 * Levels:
 *   Level 0: System Administrator
 *   Level 1: Regional Registrar
 *   Level 2: Senior Inspector
 *   Level 3: Field Inspector
 */
contract InspectorRegistry is AccessControlEnumerable, Pausable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    uint8 public constant LEVEL_ADMIN = 0;
    uint8 public constant LEVEL_REGISTRAR = 1;
    uint8 public constant LEVEL_SENIOR_INSPECTOR = 2;
    uint8 public constant LEVEL_FIELD_INSPECTOR = 3;

    struct Inspector {
        address wallet;
        uint8 level;
        uint256 jurisdictionId;
        bool active;
        uint256 validUntil;
    }

    mapping(address => Inspector) private _inspectors;

    // Events
    event InspectorAdded(address indexed wallet, uint8 level, uint256 indexed jurisdictionId, uint256 validUntil, address indexed appointedBy);
    event InspectorRevoked(address indexed wallet, address indexed revokedBy, uint256 timestamp);
    event InspectorLevelChanged(address indexed wallet, uint8 oldLevel, uint8 newLevel);
    event InspectorJurisdictionChanged(address indexed wallet, uint256 oldJurisdiction, uint256 newJurisdiction);

    // Custom Errors
    error ZeroAddress();
    error InvalidLevel(uint8 level);
    error InvalidJurisdiction();
    error InvalidValidityPeriod();
    error UnauthorizedHierarchy(address caller, uint8 targetLevel);
    error JurisdictionMismatch(uint256 callerJurisdiction, uint256 targetJurisdiction);
    error InspectorAlreadyExists(address wallet);
    error InspectorNotFound(address wallet);
    error InspectorNotActive(address wallet);

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);

        // System Admin is registered as Level 0 with global jurisdiction (0)
        _inspectors[initialAdmin] = Inspector({
            wallet: initialAdmin,
            level: LEVEL_ADMIN,
            jurisdictionId: 0,
            active: true,
            validUntil: type(uint256).max
        });
    }

    /**
     * @notice Appoints a new inspector.
     * Hierarchy rule: System Admin can appoint any level; Registrar can only appoint Level 2 or 3 within their jurisdiction.
     */
    function addInspector(
        address wallet,
        uint8 level,
        uint256 jurisdictionId,
        uint256 validUntil
    ) external whenNotPaused {
        if (wallet == address(0)) revert ZeroAddress();
        if (level > LEVEL_FIELD_INSPECTOR) revert InvalidLevel(level);
        if (validUntil <= block.timestamp) revert InvalidValidityPeriod();
        if (_inspectors[wallet].active) revert InspectorAlreadyExists(wallet);

        Inspector memory caller = _inspectors[msg.sender];

        if (hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            // Admin can appoint anyone
            if (level == LEVEL_REGISTRAR) {
                _grantRole(REGISTRAR_ROLE, wallet);
            }
        } else if (hasRole(REGISTRAR_ROLE, msg.sender)) {
            // Registrar can only appoint senior or field inspectors in their jurisdiction
            if (level <= LEVEL_REGISTRAR) revert UnauthorizedHierarchy(msg.sender, level);
            if (caller.jurisdictionId != jurisdictionId) revert JurisdictionMismatch(caller.jurisdictionId, jurisdictionId);
            if (!caller.active || caller.validUntil < block.timestamp) revert InspectorNotActive(msg.sender);
        } else {
            revert UnauthorizedHierarchy(msg.sender, level);
        }

        _inspectors[wallet] = Inspector({
            wallet: wallet,
            level: level,
            jurisdictionId: jurisdictionId,
            active: true,
            validUntil: validUntil
        });

        emit InspectorAdded(wallet, level, jurisdictionId, validUntil, msg.sender);
    }

    /**
     * @notice Revokes an inspector's authorization.
     */
    function revokeInspector(address wallet) public whenNotPaused {
        Inspector storage target = _inspectors[wallet];
        if (!target.active) revert InspectorNotFound(wallet);

        if (hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            // Admin can revoke anyone
            if (hasRole(REGISTRAR_ROLE, wallet)) {
                _revokeRole(REGISTRAR_ROLE, wallet);
            }
        } else if (hasRole(REGISTRAR_ROLE, msg.sender)) {
            Inspector memory caller = _inspectors[msg.sender];
            if (target.level <= LEVEL_REGISTRAR) revert UnauthorizedHierarchy(msg.sender, target.level);
            if (caller.jurisdictionId != target.jurisdictionId) revert JurisdictionMismatch(caller.jurisdictionId, target.jurisdictionId);
        } else {
            revert UnauthorizedHierarchy(msg.sender, target.level);
        }

        target.active = false;
        emit InspectorRevoked(wallet, msg.sender, block.timestamp);
    }

    /**
     * @notice Spec-compliant alias for revokeInspector.
     */
    function removeInspector(address wallet) external whenNotPaused {
        revokeInspector(wallet);
    }

    /**
     * @notice Updates an inspector's role level.
     */
    function changeInspectorLevel(address wallet, uint8 newLevel) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        if (newLevel > LEVEL_FIELD_INSPECTOR) revert InvalidLevel(newLevel);
        Inspector storage target = _inspectors[wallet];
        if (!target.active) revert InspectorNotFound(wallet);

        uint8 oldLevel = target.level;
        target.level = newLevel;

        if (newLevel == LEVEL_REGISTRAR && !hasRole(REGISTRAR_ROLE, wallet)) {
            _grantRole(REGISTRAR_ROLE, wallet);
        } else if (newLevel != LEVEL_REGISTRAR && hasRole(REGISTRAR_ROLE, wallet)) {
            _revokeRole(REGISTRAR_ROLE, wallet);
        }

        emit InspectorLevelChanged(wallet, oldLevel, newLevel);
    }

    /**
     * @notice Updates an inspector's regional jurisdiction.
     */
    function assignJurisdiction(address wallet, uint256 newJurisdictionId) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        Inspector storage target = _inspectors[wallet];
        if (!target.active) revert InspectorNotFound(wallet);

        uint256 oldJurisdiction = target.jurisdictionId;
        target.jurisdictionId = newJurisdictionId;

        emit InspectorJurisdictionChanged(wallet, oldJurisdiction, newJurisdictionId);
    }

    /**
     * @notice Core authorization verification logic.
     * @dev Note that in our level numbering: 0=Admin, 1=Registrar, 2=Senior, 3=Field.
     * Therefore, having `level <= minRequiredLevel` means having equal or greater authority!
     */
    function isAuthorized(address wallet, uint256 jurisdictionId, uint8 minRequiredLevel) public view returns (bool) {
        Inspector memory ins = _inspectors[wallet];
        if (!ins.active) return false;
        if (block.timestamp > ins.validUntil) return false;

        // Admin (jurisdictionId == 0) has universal cross-jurisdictional authority
        if (ins.jurisdictionId != 0 && ins.jurisdictionId != jurisdictionId) {
            return false;
        }

        return ins.level <= minRequiredLevel;
    }

    /**
     * @notice Spec-compliant alias for isAuthorized.
     */
    function isAuthorizedInspector(address wallet, uint256 jurisdictionId, uint8 minRequiredLevel) external view returns (bool) {
        return isAuthorized(wallet, jurisdictionId, minRequiredLevel);
    }

    /**
     * @notice Returns full inspector record.
     */
    function getInspector(address wallet) external view returns (Inspector memory) {
        return _inspectors[wallet];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
