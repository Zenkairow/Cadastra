# Test Plan & Empirical Evaluation Strategy (Phase 0 Freeze)

**Project:** Blockchain Land Registry  
**Test Frameworks:** Hardhat (Mocha/Chai), Slither, Pytest (HTTPX async), Playwright  
**Status:** Frozen v0.1  

---

## 1. Test Levels & CI Gates
1. **Smart Contract Unit Tests (Hardhat):**
   - 100% line and branch coverage across all 4 contracts.
   - Every `require` and revert condition must have an explicit negative unit test.
2. **Escrow Invariant Fuzz Testing:**
   - Randomized action fuzzing verifying the core invariant:
     $$\text{address}(\text{TransferEscrow}).\text{balance} \equiv \sum_{i \in \text{Unsettled}} \text{request}[i].\text{agreedPrice}$$
3. **Static Analysis (Slither):**
   - Automated CI gate verifying zero high or medium vulnerabilities (reentrancy, uninitialized state, unchecked transfers).
4. **Backend API Tests (Pytest):**
   - EIP-4361 authentication permutations (replay, wrong chain ID, expired nonces).
   - Role-based access control and database user permissions (confirming `app_user` cannot write derived tables).
5. **End-to-End Browser Tests (Playwright):**
   - Complete browser flows using test wallets on Sepolia: registration, boundary drawing, inspector approval, escrow funding, and settlement.

---

## 2. Research Experiments Specification (RQ1 – RQ6)

| Experiment ID | Focus Area | Benchmark Setup & Methodology | Success Metric / Expected Result |
| :--- | :--- | :--- | :--- |
| **RQ1** | **Inspector Governance** | Test matrix: 6 actor types (Normal, Senior, Wrong Region, Revoked, Expired, Non-Inspector) against 100 land actions. | 100% rejection rate for unauthorized actions; zero cross-jurisdiction leaks. |
| **RQ2** | **Duplicate Detection** | Generate synthetic dataset: 1,000 unique parcels + 100 exact duplicate keys + 50 spatial overlaps + 25 edge-contacts. | Layer 1 blocks 100/100 exact keys on-chain; Layer 2 PostGIS flags 50/50 overlaps without false-positive edge contacts. |
| **RQ3** | **Escrow Security** | Execute test cases TC01–TC10 (underpayment, overpayment, unauthorized refund, double release, reentrancy). | All invalid state transitions revert with gas consumption documented. |
| **RQ4** | **Event Synchronization** | Process 1,000 continuous contract events. Inject manual database tampering and trigger reconciliation. | Zero duplicate event processing (idempotency); DB tampering detected and self-healed from chain logs. |
| **RQ5** | **Document Integrity** | Hash 100 legal documents. Apply 4 tampering profiles (1-byte flip, metadata change, page deletion, complete replacement). | 100% detection rate of hash divergence against on-chain manifest commitment. |
| **RQ6** | **Read Scalability** | Compare direct JSON-RPC per-record calls vs PostGIS indexed SQL queries across $N \in \{10, 50, 100, 500, 1000, 5000\}$ parcels. | Measure response latency, RPC call count, and bandwidth savings. Demonstrate $O(1)$ vs $O(N)$ scalability. |
