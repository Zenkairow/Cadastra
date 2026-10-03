# Cadastra — System Administrator & Registrar Operations Manual

This manual provides an operational guide for Platform Administrators and Regional Registrars managing identity verification, inspector governance, system parameters, indexer monitoring, and emergency circuit breakers across the Cadastra platform.

---

## 1. Administrative Roles & Privilege Separation

Cadastra enforces a strict administrative hierarchy across smart contracts and off-chain infrastructure:

```
┌────────────────────────────────────────────────────────┐
│              Platform Administrator (Owner)            │
│  - Contract Deployment & Upgrades                      │
│  - Appoints Regional Registrars                        │
│  - Controls Emergency Pausable Circuit Breakers        │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│ Registrar (Jurisdiction 1)│   │ Registrar (Jurisdiction 2)│
│ - Appoints Inspectors     │   │ - Appoints Inspectors     │
│ - Revokes Compromised Keys│   │ - Revokes Compromised Keys│
│ - Validates KYC Bindings  │   │ - Validates KYC Bindings  │
└───────────────────────────┘   └───────────────────────────┘
```

---

## 2. Identity Registry Administration

The `IdentityRegistry.sol` contract enforces the core invariant: **One opaque identity maps to at most one active wallet address at any given time**.

### 2.1 Verifying and Binding User Identity
When an applicant completes off-chain KYC verification:
1. Open the **Admin Console** $\to$ **Identity Verification**.
2. Input the platform-generated pseudo-anonymous identity ID (UUIDv4) and applicant's verified wallet address:
   ```solidity
   identityRegistry.verifyAndBindIdentity(identityId, walletAddress);
   ```
3. The contract binds `walletToIdentity[walletAddress] = identityId` and emits the `IdentityBound` event.
4. *Security Invariant:* Neither the applicant's name, physical address, nor government ID number is stored on-chain or in the PostgreSQL read model.

### 2.2 Wallet Recovery & Re-Keying Protocol
If a citizen's private key is lost or compromised:
1. Conduct verified out-of-band identity re-authentication.
2. In the Admin Console, revoke the old wallet:
   ```solidity
   identityRegistry.revokeWallet(oldWalletAddress);
   ```
3. Bind the citizen's new wallet:
   ```solidity
   identityRegistry.activateWallet(identityId, newWalletAddress);
   ```
4. All previously verified land titles remain immutably associated with the underlying platform identity.

---

## 3. Inspector Governance Administration

The `InspectorRegistry.sol` contract manages inspector appointments, jurisdictional territories, and role levels.

### 3.1 Appointing a New Land Inspector
1. Navigate to **Admin Console** $\to$ **Inspector Management**.
2. Click **Appoint Inspector** and complete the authorization parameters:
   - **Inspector Wallet:** `0x...`
   - **Inspector Level:** `1` (Standard Inspector) or `2` (Senior Inspector)
   - **Jurisdiction ID:** e.g., `1001` (Bengaluru Urban)
   - **Validity Duration:** Expiration timestamp (e.g., 365 days from current block timestamp).
3. Sign the transaction in MetaMask:
   ```solidity
   inspectorRegistry.addInspector(wallet, level, jurisdictionId, validUntil);
   ```
4. The contract emits `InspectorAdded(wallet, level, jurisdictionId, validUntil)`.

### 3.2 Modifying Inspector Levels & Jurisdictions
- To promote an inspector to Senior Inspector:
  ```solidity
  inspectorRegistry.changeInspectorLevel(wallet, 2);
  ```
- To transfer an inspector to a new jurisdiction:
  ```solidity
  inspectorRegistry.assignJurisdiction(wallet, newJurisdictionId);
  ```

### 3.3 Emergency Inspector Revocation
If an inspector's credentials or physical workstation are compromised:
1. Navigate to **Inspector Management** $\to$ Select Inspector Wallet.
2. Click **Revoke Inspector Immediately**.
3. Sign the revocation transaction:
   ```solidity
   inspectorRegistry.revokeInspector(wallet);
   ```
4. The inspector's status is atomically set to `active = false`. Any pending or subsequent attempts to approve lands or escrows will instantly revert.

---

## 4. Indexer Monitoring & Operational Health

The confirmation-aware event indexer continuously syncs on-chain events with the PostgreSQL read model.

### 4.1 Checking Indexer Status
Monitor indexer health via the admin health endpoint or system console:
```bash
curl http://localhost:8000/api/v1/health
```
Key health metrics:
- **`latest_block_number`**: Current block height on Ethereum Sepolia.
- **`last_indexed_block`**: Last block ingested by the indexer daemon.
- **`block_lag`**: Difference between head block and indexed block (nominal lag $\le 12$ blocks due to confirmation depth).
- **`sync_status`**: `CONFIRMED` or `PENDING`.

### 4.2 Executing Self-Healing Reconciliation
If database tampering, network partition, or RPC dropouts cause divergence:
1. Run the reconciliation audit engine:
   ```bash
   python -m backend.app.indexer.reconciliation
   ```
2. The engine queries on-chain contract state directly (`getLand()`, `getRequest()`), compares each record against PostgreSQL, and automatically overwrites any diverged records with on-chain ground truth.
3. In Phase 10 benchmarks, self-healing restored full database integrity in **6.11 milliseconds**.

---

## 5. Emergency Circuit Breakers (Pausable)

Both `LandRegistry.sol` and `TransferEscrow.sol` implement OpenZeppelin's `Pausable` contract to halt critical state transitions during security incidents.

### 5.1 Triggering an Emergency Pause
If an active vulnerability or external threat is detected:
1. Connect the Platform Administrator wallet.
2. Navigate to **Admin Console** $\to$ **Emergency Controls**.
3. Click **Activate Emergency Circuit Breaker**.
4. Confirm `pause()` on `LandRegistry` and `TransferEscrow`.
5. Once paused:
   - All land registrations, approvals, and transfers revert (`EnforcedPause()`).
   - Deposit and settlement functions in `TransferEscrow` are blocked.
   - User pull-payment withdrawals remain active (or paused depending on safety policy) to prevent fund lockups.

### 5.2 Resuming Normal Operations
Once the incident is resolved:
1. Click **Deactivate Emergency Pause**.
2. Confirm `unpause()` on the affected contracts.
3. System operations resume with full historical audit logs intact.
