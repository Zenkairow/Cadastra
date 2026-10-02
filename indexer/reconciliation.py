import logging
from typing import Dict, Any, List, Optional
from decimal import Decimal
from web3 import Web3
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.database import AsyncSessionLocal
from backend.app.models.models import Land, Escrow, AuditLog
from indexer.abi_loader import get_contract_abi
from indexer.config import indexer_settings

logger = logging.getLogger("reconciliation")

LAND_STATUS_MAP = {
    0: "PENDING_VERIFICATION",
    1: "VERIFIED",
    2: "LOCKED_IN_TRANSFER",
    3: "REJECTED"
}

ESCROW_STATE_MAP = {
    0: "REQUESTED",
    1: "FUNDED",
    2: "UNDER_REVIEW",
    3: "APPROVED",
    4: "COMPLETED",
    5: "CANCELLED",
    6: "REJECTED",
    7: "EXPIRED",
    8: "REFUNDED"
}

class ReconciliationEngine:
    """
    Self-healing audit engine that cross-references PostgreSQL derived read-model
    records with authoritative Ethereum smart contract state.
    """
    def __init__(self, w3: Optional[Web3] = None):
        self.w3 = w3 or Web3(Web3.HTTPProvider(indexer_settings.rpc_url))
        self.land_contract = None
        self.escrow_contract = None

        if indexer_settings.land_registry_address and Web3.is_address(indexer_settings.land_registry_address):
            self.land_contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(indexer_settings.land_registry_address),
                abi=get_contract_abi("LandRegistry")
            )

        if indexer_settings.transfer_escrow_address and Web3.is_address(indexer_settings.transfer_escrow_address):
            self.escrow_contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(indexer_settings.transfer_escrow_address),
                abi=get_contract_abi("TransferEscrow")
            )

    async def reconcile_lands(self, session: AsyncSession, land_contract_instance=None, land_id: Optional[int] = None) -> Dict[str, Any]:
        contract = land_contract_instance or self.land_contract
        if not contract:
            return {"checked": 0, "mismatches": 0, "repaired": 0, "skipped": True}

        stmt = select(Land)
        if land_id is not None:
            stmt = stmt.where(Land.land_id == land_id)
        res = await session.execute(stmt)
        lands = res.scalars().all()

        checked = 0
        mismatches = 0
        repaired = 0

        for land in lands:
            checked += 1
            try:
                # getLand returns tuple: (parcelKey, ownerIdentityId, jurisdictionId, status, geometryHash, documentManifestHash, registeredAt, verifiedAt, activeTransferId)
                chain_land = contract.functions.getLand(land.land_id).call()
                chain_parcel_key = "0x" + chain_land[0].hex().lower()
                chain_owner = "0x" + chain_land[1].hex().lower()
                chain_status = LAND_STATUS_MAP.get(chain_land[3], "UNKNOWN")
                chain_active_transfer = chain_land[8] if len(chain_land) > 8 else None

                divergence = []
                if land.owner_identity_id.lower() != chain_owner.lower():
                    divergence.append(f"owner mismatch: DB={land.owner_identity_id} CHAIN={chain_owner}")
                if land.status != chain_status:
                    divergence.append(f"status mismatch: DB={land.status} CHAIN={chain_status}")

                if divergence:
                    mismatches += 1
                    logger.warning(f"SYNC_ERROR on Land {land.land_id}: {'; '.join(divergence)}")

                    # 1. Log SYNC_ERROR alert
                    audit_error = AuditLog(
                        action="SYNC_ERROR_DETECTED",
                        details={
                            "entity": "LAND",
                            "land_id": land.land_id,
                            "divergence": divergence
                        }
                    )
                    session.add(audit_error)

                    # 2. Self-Healing: Reconcile DB with authoritative on-chain truth
                    land.owner_identity_id = chain_owner.lower()
                    land.status = chain_status
                    if chain_active_transfer:
                        land.active_transfer_id = chain_active_transfer if chain_active_transfer > 0 else None

                    # 3. Log Repair
                    audit_repair = AuditLog(
                        action="SYNC_ERROR_REPAIRED",
                        details={
                            "entity": "LAND",
                            "land_id": land.land_id,
                            "healed_owner": chain_owner.lower(),
                            "healed_status": chain_status
                        }
                    )
                    session.add(audit_repair)
                    repaired += 1

            except Exception as e:
                logger.error(f"Error checking Land {land.land_id} on-chain: {e}")

        await session.commit()
        return {"checked": checked, "mismatches": mismatches, "repaired": repaired}

    async def reconcile_escrows(self, session: AsyncSession, escrow_contract_instance=None, request_id: Optional[int] = None) -> Dict[str, Any]:
        contract = escrow_contract_instance or self.escrow_contract
        if not contract:
            return {"checked": 0, "mismatches": 0, "repaired": 0, "skipped": True}

        stmt = select(Escrow)
        if request_id is not None:
            stmt = stmt.where(Escrow.request_id == request_id)
        res = await session.execute(stmt)
        escrows = res.scalars().all()

        checked = 0
        mismatches = 0
        repaired = 0

        for esc in escrows:
            checked += 1
            try:
                # getRequest returns tuple: (requestId, landId, buyerIdentityId, sellerIdentityId, agreedPrice, depositAmount, createdAt, expiresAt, state, approvalCount, hasSeniorApproval)
                req = contract.functions.getRequest(esc.request_id).call()
                chain_state = ESCROW_STATE_MAP.get(req[8], "UNKNOWN")
                chain_price = Decimal(req[4]) / Decimal(10**18)

                divergence = []
                if esc.state != chain_state:
                    divergence.append(f"state mismatch: DB={esc.state} CHAIN={chain_state}")
                if esc.agreed_price != chain_price:
                    divergence.append(f"price mismatch: DB={esc.agreed_price} CHAIN={chain_price}")

                if divergence:
                    mismatches += 1
                    logger.warning(f"SYNC_ERROR on Escrow {esc.request_id}: {'; '.join(divergence)}")

                    audit_error = AuditLog(
                        action="SYNC_ERROR_DETECTED",
                        details={
                            "entity": "ESCROW",
                            "request_id": esc.request_id,
                            "divergence": divergence
                        }
                    )
                    session.add(audit_error)

                    # Self-heal
                    esc.state = chain_state
                    esc.agreed_price = chain_price

                    audit_repair = AuditLog(
                        action="SYNC_ERROR_REPAIRED",
                        details={
                            "entity": "ESCROW",
                            "request_id": esc.request_id,
                            "healed_state": chain_state
                        }
                    )
                    session.add(audit_repair)
                    repaired += 1

            except Exception as e:
                logger.error(f"Error checking Escrow {esc.request_id} on-chain: {e}")

        await session.commit()
        return {"checked": checked, "mismatches": mismatches, "repaired": repaired}

    async def run_full_reconciliation(self, session: Optional[AsyncSession] = None) -> Dict[str, Any]:
        """Runs complete reconciliation audit across all derived models."""
        async def _run(s: AsyncSession):
            land_report = await self.reconcile_lands(s)
            escrow_report = await self.reconcile_escrows(s)
            return {
                "lands": land_report,
                "escrows": escrow_report,
                "total_checked": land_report.get("checked", 0) + escrow_report.get("checked", 0),
                "total_mismatches": land_report.get("mismatches", 0) + escrow_report.get("mismatches", 0),
                "total_repaired": land_report.get("repaired", 0) + escrow_report.get("repaired", 0)
            }

        if session:
            return await _run(session)
        else:
            async with AsyncSessionLocal() as s:
                return await _run(s)

reconciliation_engine = ReconciliationEngine()
