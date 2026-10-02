import os
from pydantic_settings import BaseSettings
from typing import Optional

class IndexerSettings(BaseSettings):
    rpc_url: str = os.getenv("RPC_URL", "http://127.0.0.1:8545")
    chain_id: int = int(os.getenv("CHAIN_ID", "11155111"))
    confirmation_depth: int = int(os.getenv("CONFIRMATION_DEPTH", "1")) # 1 for local dev/testing, 6 for Sepolia
    batch_size: int = int(os.getenv("INDEXER_BATCH_SIZE", "2000"))
    poll_interval_seconds: float = float(os.getenv("INDEXER_POLL_INTERVAL", "2.0"))
    max_retries: int = int(os.getenv("INDEXER_MAX_RETRIES", "5"))
    backoff_factor: float = float(os.getenv("INDEXER_BACKOFF_FACTOR", "1.5"))

    # Contract Addresses (Sepolia or local testnet)
    identity_registry_address: Optional[str] = os.getenv("IDENTITY_REGISTRY_ADDRESS", None)
    inspector_registry_address: Optional[str] = os.getenv("INSPECTOR_REGISTRY_ADDRESS", None)
    land_registry_address: Optional[str] = os.getenv("LAND_REGISTRY_ADDRESS", None)
    transfer_escrow_address: Optional[str] = os.getenv("TRANSFER_ESCROW_ADDRESS", None)

    # Initial deployment block heights to begin indexing from
    start_block: int = int(os.getenv("INDEXER_START_BLOCK", "0"))

    class Config:
        env_file = ".env"
        extra = "ignore"

indexer_settings = IndexerSettings()
