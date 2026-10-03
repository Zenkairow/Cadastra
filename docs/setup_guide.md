# Cadastra (Blockchain Land Registry) — Reproducible Setup Guide & Clean-Machine Runbook

This guide provides end-to-end instructions for deploying, configuring, and verifying the **Cadastra** Land Registry platform from a completely clean machine.

---

## 1. System Requirements & Prerequisites

Ensure the following tools and runtimes are installed on your host system:

| Tool / Runtime | Minimum Version | Recommended Version | Verification Command |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v18.16.0` | `v20.x LTS` | `node -v` |
| **npm** | `v9.5.0` | `v10.x` | `npm -v` |
| **Python** | `3.10.0` | `3.11.x` | `python --version` |
| **Docker & Docker Compose** | `v24.0.0` | Latest | `docker compose version` |
| **Git** | `v2.30.0` | Latest | `git --version` |
| **MetaMask Wallet** | Modern extension | Latest | In Chromium or Firefox |

> [!NOTE]
> If running natively on Windows or Linux without Docker, ensure PostgreSQL 15+ with the **PostGIS 3.3+** extension and MinIO (or AWS S3 credentials) are installed locally.

---

## 2. Repository Cloning & Directory Layout

Clone the repository and inspect the workspace:

```bash
git clone https://github.com/Zenkairow/Cadastra.git
cd Cadastra
```

The repository structure is organized into modular tiers:
```
Cadastra/
├── contracts/          # Solidity smart contracts, Hardhat config, deployment scripts & unit tests
├── backend/            # FastAPI REST API, SQLAlchemy ORM, PostGIS spatial models & event indexer
├── frontend/           # React 18, Vite, Tailwind CSS, Leaflet cadastral map & Web3 provider
├── scripts/            # Empirical benchmark scripts, synthetic generator & master runner
├── docs/               # Technical whitepaper, specs, security reports, manuals & research paper
└── docker-compose.yml  # Containerized PostgreSQL/PostGIS and MinIO services
```

---

## 3. Environment Configuration

Copy the example environment configuration template:

```bash
cp .env.example .env
```

Verify or configure the following environment parameters:

### Smart Contracts (`contracts/.env` or root `.env`)
```ini
SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
PRIVATE_KEY="0xYOUR_TESTNET_DEPLOYER_PRIVATE_KEY"
ETHERSCAN_API_KEY="YOUR_ETHERSCAN_API_KEY"
```

### Backend & Indexer (`backend/.env` or root `.env`)
```ini
DATABASE_URL="postgresql://cadastra:cadastra_secret@localhost:5432/cadastra_db"
MINIO_ENDPOINT="localhost:9000"
MINIO_ACCESS_KEY="cadastra_minio"
MINIO_SECRET_KEY="cadastra_minio_secret"
MINIO_BUCKET="cadastra-documents"
MINIO_SECURE="False"
JWT_SECRET_KEY="cadastra_super_secret_jwt_key_for_development"
INDEXER_CONFIRMATION_DEPTH="12"
INDEXER_POLL_INTERVAL_SECONDS="3"
```

### Frontend (`frontend/.env` or root `.env`)
```ini
VITE_API_URL="http://localhost:8000"
VITE_CHAIN_ID="11155111"
VITE_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
```

---

## 4. Infrastructure Provisioning (Database & Storage)

Start the local containerized services using Docker Compose:

```bash
docker compose up -d
```

This brings up:
1. **PostgreSQL with PostGIS** on port `5432` (`cadastra_db`).
2. **MinIO Object Storage** on port `9000` (API) and `9001` (Web Console).

Verify database connectivity and PostGIS activation:
```bash
docker exec -it cadastra_postgres psql -U cadastra -d cadastra_db -c "SELECT PostGIS_Full_Version();"
```

---

## 5. Smart Contract Deployment & Verification

Navigate to the `contracts/` directory and install dependencies:

```bash
cd contracts
npm install
```

### Option A: Local In-Memory Development & Testing
Run the Hardhat test suite to verify contract compilation, access control, and invariants:
```bash
npx hardhat test
```
*Expected: 68 tests passing (100% green).*

To spin up a local Hardhat node and deploy contracts:
```bash
# Terminal 1: Start local EVM node
npx hardhat node

# Terminal 2: Deploy contracts to local node
npx hardhat run scripts/deploy.js --network localhost
```

### Option B: Ethereum Sepolia Testnet Deployment
To deploy to the live Ethereum Sepolia testnet (`11155111`):
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Verify contracts on Etherscan:
```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```
The deployed addresses will be saved automatically to `deployments/sepolia.json` and mirrored into `backend/app/core/config.py` and `frontend/src/config/contracts.json`.

---

## 6. Backend API Setup & Database Migrations

From the project root:

```bash
# Create and activate Python virtual environment
python -m venv venv

# Windows:
.\venv\Scripts\activate
# Linux/macOS:
# source venv/bin/activate

# Install backend dependencies
pip install -r backend/requirements.txt
```

Apply database migrations:
```bash
alembic -c backend/alembic.ini upgrade head
```

Optionally, seed sample test identities, jurisdictions, and parcels:
```bash
python -m backend.scripts.seed_db
```

Start the FastAPI application server:
```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```
Interactive OpenAPI documentation will be accessible at: `http://localhost:8000/docs`.

---

## 7. Starting the Event Synchronization Indexer

The event indexer operates as an autonomous daemon monitoring on-chain log events and updating the PostgreSQL read model:

```bash
# Ensure virtual environment is active
python -m backend.app.indexer.runner
```
The indexer will track the confirmed block height, stream logs with a 12-block confirmation window, and trigger self-healing reconciliation if divergence is detected.

---

## 8. Frontend Web Application Launch

Navigate to the `frontend/` directory and install dependencies:

```bash
cd frontend
npm install
```

Start the Vite development server:
```bash
npm run dev
```

Open your browser at: `http://localhost:5173`.
- Ensure MetaMask is installed.
- Add and switch to the **Ethereum Sepolia** network (Chain ID: `11155111`).
- Connect your wallet to access the citizen, inspector, or administrator views based on your assigned role.

---

## 9. Executing Experimental Benchmarks & Verifications

To reproduce the scientific benchmarks (RQ1–RQ6) and gas profiles locally:

```bash
# Run the complete experimental harness
python scripts/run_all_experiments.py
```

Individual benchmarks can be executed independently:
- **Contract Gas Profiler:** `node contracts/scripts/gas_profiler.js`
- **RQ1 Authorization Matrix:** `node contracts/scripts/experiment_rq1_authorization.js`
- **RQ2 Geospatial Duplicate Engine:** `python scripts/generate_synthetic_parcels.py --benchmark`
- **RQ3 Escrow Safety & Custody:** `node contracts/scripts/experiment_rq3_escrow.js`
- **RQ4 Indexer Latency & Self-Healing:** `python scripts/experiment_rq4_synchronization.py`
- **RQ5 Cryptographic Tamper Lab:** `python scripts/experiment_rq5_document_integrity.py`
- **RQ6 Read Scaling & Latency:** `python scripts/experiment_rq6_read_scaling.py`

Results will be generated in `docs/benchmark_*.json` and `docs/benchmark_*.csv`.
