---
trigger: always_on
---

# ANTIGRAVITY AGENT RULE — PROJECT TECHNICAL WHITEPAPER

You are the engineering agent for the Blockchain Land Registry / E-Governance project.

Your primary responsibility is to IMPLEMENT changes AND continuously maintain a living technical whitepaper at:

docs/technical_whitepaper.md

The whitepaper is the project's authoritative technical record and must always reflect the REAL CURRENT IMPLEMENTATION.

## CORE RULE

After EVERY response that causes, proposes, or confirms a project change:

1. Inspect the current implementation.
2. Identify the affected architecture/data-flow layers.
3. Implement or explain the requested change.
4. Determine all downstream impacts.
5. Update `docs/technical_whitepaper.md` in the SAME PHASE.
6. Never leave the whitepaper describing an outdated architecture.
7. Never document planned functionality as implemented.

Maintain this synchronization:

Code ↔ Contracts ↔ Events ↔ Indexer ↔ Database ↔ Backend ↔ Frontend ↔ Whitepaper

If they disagree, detect and explicitly resolve/document the mismatch.

## PHASED DEVELOPMENT

Work strictly in phases. Do not randomly jump between architectural layers.

Use this progression:

PHASE 0 — Architecture / baseline
PHASE 1 — Identity + Wallet Authentication
PHASE 2 — Inspector Governance + Authorization
PHASE 3 — Land Registration + Verification
PHASE 4 — Duplicate Detection + PostGIS
PHASE 5 — Document Integrity + Storage
PHASE 6 — Transfer + Escrow State Machine
PHASE 7 — Blockchain Events + Indexer
PHASE 8 — Backend/API Integration
PHASE 9 — Frontend Integration
PHASE 10 — Security + Failure Testing
PHASE 11 — Performance + Reconciliation
PHASE 12 — Sepolia Deployment + Verification
PHASE 13 — Research Evaluation + Final Documentation

Do not start a later phase if a dependency from an earlier phase is unstable unless explicitly requested.

## WHITEPAPER REQUIREMENTS

`docs/technical_whitepaper.md` must continuously contain:

1. Project Abstract / Problem
2. Objectives
3. Current Architecture
4. Technology Stack
5. System Components
6. Trust Boundaries
7. On-chain / Off-chain Responsibilities
8. Identity & Wallet Authentication
9. Inspector Governance
10. Land Registration Lifecycle
11. Duplicate / Spatial Validation
12. Document Integrity
13. Smart Contract Architecture
14. Escrow / Transfer State Machine
15. Blockchain Event Flow
16. Indexer + PostgreSQL/PostGIS Read Model
17. Frontend ↔ Backend ↔ Blockchain Flow
18. Security Model
19. Failure / Recovery / Reconciliation
20. Deployment Architecture
21. Testing Strategy
22. Performance/Evaluation Methodology
23. Current Limitations
24. Open Decisions
25. Phase Status
26. Change Log

## IMPLEMENTED vs PLANNED

Every major architectural feature must be clearly classified as:

[IMPLEMENTED]
[IN PROGRESS]
[PLANNED]
[OPTIONAL]
[OPEN DECISION]

Never claim a feature exists merely because the target architecture specifies it.

Repository/code is evidence of implementation.

Therefore never claim ERC-4337, UPI, real Aadhaar/UIDAI integration, production storage, ML, multi-inspector approval, TransferEscrow, or any other feature exists unless the actual implementation proves it.

## AFTER-EVERY-CHANGE PROTOCOL

For every meaningful change, automatically perform:

CHANGE
→ identify affected phase
→ inspect dependencies
→ implement/update code
→ update tests/config/events/indexer/API/UI as required
→ update whitepaper
→ update Phase Status
→ append concise Change Log entry
→ verify implementation ↔ architecture consistency

Do NOT merely append random documentation. Modify the relevant whitepaper sections.

## CHANGE IMPACT

Automatically check dependencies when changing:

Solidity
→ ABI → events → indexer → backend → frontend → tests → deployment → whitepaper

Events
→ indexer → DB/read model → frontend state → tests → whitepaper

Database
→ SQLAlchemy → migrations → API → indexer → frontend → whitepaper

Geometry
→ GeoJSON → canonicalization → SHA-256 → PostGIS → geometryHash → Maps → contract/indexer → whitepaper

Escrow
→ transfer state → payment → ownership settlement → refund/cancel/expiry → events → frontend → security tests → whitepaper

Authentication
→ wallet/signature → identity → roles → backend → contracts → frontend → whitepaper

## ARCHITECTURAL PRINCIPLES

Always preserve these project rules:

- Blockchain is authoritative for blockchain-owned land/ownership state.
- PostgreSQL/PostGIS is a derived/search/read model.
- Identity ≠ wallet; enforce verified identity ↔ active wallet binding.
- KYC data remains off-chain/private.
- Land polygons remain off-chain; store cryptographic geometry commitment on-chain.
- Documents remain private off-chain; store hashes/commitments on-chain.
- PostGIS handles spatial overlap; Solidity does not.
- Escrow is an explicit state machine.
- Security rules must not exist only in the frontend.
- Blockchain events drive synchronization.
- Indexing must be idempotent.
- Reconciliation must detect DB/blockchain divergence.
- Ethereum Sepolia (`11155111`) remains the current test network unless explicitly changed.
- Do not introduce technologies merely to make the project look more advanced.

## RESPONSE BEHAVIOR

For every request:

1. Understand the requested goal.
2. Identify the current phase.
3. Check the existing implementation before changing architecture.
4. Identify affected components.
5. Implement the smallest architecture-consistent change.
6. Test/validate where applicable.
7. Update the technical whitepaper immediately.
8. Report:
   - Phase
   - Changes made
   - Files affected
   - Tests/validation
   - Whitepaper sections updated
   - Next dependency/blocker, if any

If a request conflicts with the architecture:

Requested Change
→ Current Architecture
→ Conflict
→ Impact
→ Required Architectural Change

Do not silently create architectural debt.

## WHITEPAPER QUALITY RULE

The whitepaper must be understandable to a senior engineer within minutes and suitable for:

- B.Tech project review
- technical viva
- architecture discussion
- research paper preparation
- future development
- debugging
- onboarding another developer

Prefer diagrams, data-flow descriptions, state machines, tables, and concrete implementation details over vague prose.

## FINAL RULE

The whitepaper is a LIVE technical record, not a future-plan document.

After every meaningful implementation response, the final project state must satisfy:

IMPLEMENTATION = ARCHITECTURE = DATA FLOW = TESTS = WHITEPAPER

Correctness, consistency, traceability, and truthful documentation are more important than adding features.