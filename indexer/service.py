import asyncio
import logging
from typing import List, Optional, Dict, Any
from web3 import Web3
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from backend.app.database import AsyncSessionLocal
from backend.app.models.models import BlockchainEvent, SyncState, Land, Escrow, Inspector
from indexer.config import indexer_settings
from indexer.event_parser import event_parser, ParsedEvent
from indexer.handlers import dispatch_event

logger = logging.getLogger("indexer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

class EventIndexer:
    """
    Confirmation-aware, idempotent blockchain event indexer that materializes
    EVM event logs into the PostgreSQL derived read model.
    """
    def __init__(self, w3: Optional[Web3] = None):
        self.w3 = w3 or Web3(Web3.HTTPProvider(indexer_settings.rpc_url))
        self.chain_id = indexer_settings.chain_id
        self.confirmation_depth = indexer_settings.confirmation_depth
        self.batch_size = indexer_settings.batch_size
        self.poll_interval = indexer_settings.poll_interval_seconds
        self.is_running = False

    def get_monitored_addresses(self) -> List[str]:
        addresses = []
        for addr in [
            indexer_settings.identity_registry_address,
            indexer_settings.inspector_registry_address,
            indexer_settings.land_registry_address,
            indexer_settings.transfer_escrow_address
        ]:
            if addr and Web3.is_address(addr):
                addresses.append(Web3.to_checksum_address(addr))
        return addresses

    async def get_or_create_sync_state(self, session: AsyncSession, contract_address: str, contract_name: str) -> SyncState:
        stmt = select(SyncState).where(SyncState.contract_address == contract_address.lower())
        res = await session.execute(stmt)
        state = res.scalar_one_or_none()
        if not state:
            state = SyncState(
                contract_address=contract_address.lower(),
                contract_name=contract_name,
                chain_id=self.chain_id,
                last_processed_block=indexer_settings.start_block,
                last_processed_block_hash=None
            )
            session.add(state)
            await session.flush()
        return state

    async def process_single_event(self, session: AsyncSession, event: ParsedEvent) -> bool:
        """
        Idempotently records an event and executes its domain handler in a single atomic transaction.
        Returns True if newly processed, False if duplicate skipped.
        """
        # 1. Idempotency Check: (transaction_hash, log_index)
        stmt = select(BlockchainEvent).where(
            BlockchainEvent.transaction_hash == event.transaction_hash,
            BlockchainEvent.log_index == event.log_index
        )
        res = await session.execute(stmt)
        existing = res.scalar_one_or_none()

        if existing:
            logger.debug(f"Skipping already-indexed event: tx={event.transaction_hash} log={event.log_index}")
            return False

        # 2. Record Event Record
        db_event = BlockchainEvent(
            chain_id=self.chain_id,
            contract_address=event.contract_address.lower(),
            block_number=event.block_number,
            block_hash=event.block_hash,
            transaction_hash=event.transaction_hash,
            log_index=event.log_index,
            event_name=event.event_name,
            payload=event.args,
            sync_status="FINALIZED"
        )
        session.add(db_event)

        # 3. Dispatch to Domain Handlers (lands, escrows, inspectors, users)
        await dispatch_event(session, event)
        return True

    async def process_logs(self, session: AsyncSession, logs: List[Dict[str, Any]]) -> int:
        """Processes a list of raw EVM logs in chronological order."""
        processed_count = 0
        for log in logs:
            parsed = event_parser.parse_log(log)
            if parsed:
                newly_processed = await self.process_single_event(session, parsed)
                if newly_processed:
                    processed_count += 1
        return processed_count

    async def handle_potential_reorg(self, session: AsyncSession, from_block: int, expected_parent_hash: Optional[str]) -> bool:
        """
        Validates parent block hash. If reorg is detected, marks orphaned events and steps back.
        Returns True if reorg was handled, False if chain is continuous.
        """
        if not expected_parent_hash or from_block <= 0:
            return False

        try:
            parent_block = self.w3.eth.get_block(from_block - 1)
            actual_parent_hash = "0x" + parent_block["hash"].hex().lower()
            if actual_parent_hash != expected_parent_hash.lower():
                logger.warning(
                    f"REORG DETECTED at block {from_block}! "
                    f"Stored: {expected_parent_hash}, Canonical: {actual_parent_hash}"
                )
                # Mark orphaned events for rollback
                await session.execute(
                    update(BlockchainEvent)
                    .where(BlockchainEvent.block_number >= from_block - 1)
                    .values(sync_status="ORPHANED")
                )
                return True
        except Exception as e:
            logger.error(f"Error checking reorg status: {e}")
        return False

    async def sync_range(self, from_block: int, to_block: int, session: Optional[AsyncSession] = None) -> int:
        """
        Synchronizes all events across the monitored contracts between from_block and to_block.
        """
        monitored_addresses = self.get_monitored_addresses()
        filter_params: Dict[str, Any] = {
            "fromBlock": from_block,
            "toBlock": to_block
        }
        if monitored_addresses:
            filter_params["address"] = monitored_addresses

        logger.info(f"Fetching logs from block {from_block} to {to_block} (targets: {len(monitored_addresses)} contracts)")

        try:
            logs = self.w3.eth.get_logs(filter_params)
        except Exception as e:
            logger.error(f"Failed to fetch logs [{from_block}..{to_block}]: {e}")
            raise

        async def _apply(s: AsyncSession) -> int:
            count = await self.process_logs(s, logs)
            # Update sync state
            global_sync = await self.get_or_create_sync_state(s, "0x0000000000000000000000000000000000000000", "GLOBAL_INDEXER")
            global_sync.last_processed_block = to_block
            try:
                latest_block_obj = self.w3.eth.get_block(to_block)
                global_sync.last_processed_block_hash = "0x" + latest_block_obj["hash"].hex()
            except Exception:
                pass
            await s.commit()
            return count

        if session:
            return await _apply(session)
        else:
            async with AsyncSessionLocal() as db_session:
                return await _apply(db_session)

    async def get_sync_status(self) -> Dict[str, Any]:
        """Returns sync metrics: chain head, last indexed block, lag, and total event count."""
        try:
            latest_block = self.w3.eth.block_number
        except Exception:
            latest_block = -1

        async with AsyncSessionLocal() as session:
            state = await self.get_or_create_sync_state(session, "0x0000000000000000000000000000000000000000", "GLOBAL_INDEXER")
            last_block = state.last_processed_block

            # Count total events
            stmt = select(BlockchainEvent)
            res = await session.execute(stmt)
            event_count = len(res.scalars().all())

            lag = max(0, latest_block - last_block) if latest_block >= 0 else 0

            return {
                "chain_id": self.chain_id,
                "latest_chain_block": latest_block,
                "last_processed_block": last_block,
                "sync_lag": lag,
                "total_events_indexed": event_count,
                "confirmation_depth": self.confirmation_depth,
                "status": "HEALTHY" if lag <= self.confirmation_depth + 2 else "CATCHING_UP"
            }

    async def run_daemon(self):
        """Continuous background event polling loop."""
        self.is_running = True
        logger.info(f"Starting Indexer Daemon (Chain ID: {self.chain_id}, Confirmation Depth: {self.confirmation_depth})")

        while self.is_running:
            try:
                latest_chain_block = self.w3.eth.block_number
                confirmed_head = max(0, latest_chain_block - self.confirmation_depth)

                async with AsyncSessionLocal() as session:
                    state = await self.get_or_create_sync_state(session, "0x0000000000000000000000000000000000000000", "GLOBAL_INDEXER")
                    current_block = state.last_processed_block

                if current_block < confirmed_head:
                    next_block = current_block + 1
                    chunk_end = min(current_block + self.batch_size, confirmed_head)
                    await self.sync_range(next_block, chunk_end)
                else:
                    await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in indexer polling cycle: {e}")
                await asyncio.sleep(self.poll_interval * 2)

        logger.info("Indexer Daemon stopped.")
