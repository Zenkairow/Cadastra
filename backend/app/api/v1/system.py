from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from backend.app.database import get_db
from backend.app.models.models import SyncState, AuditLog, User
from backend.app.schemas.schemas import SyncStatusResponse, AuditLogResponse
from backend.app.api.dependencies import require_role

router = APIRouter(prefix="/system", tags=["System & Read-Model Operations"])

@router.get("/sync-status", response_model=List[SyncStatusResponse])
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Fetch current block synchronization progress and indexer lag per contract."""
    stmt = select(SyncState)
    records = (await db.execute(stmt)).scalars().all()
    return [SyncStatusResponse.model_validate(r) for r in records]

@router.get("/audit-logs", response_model=List[AuditLogResponse])
async def get_audit_logs(
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Retrieve immutable audit logs tracking role modifications, repairs, and events."""
    stmt = select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(limit)
    logs = (await db.execute(stmt)).scalars().all()
    return [AuditLogResponse.model_validate(l) for l in logs]

@router.post("/reconcile")
async def trigger_reconciliation(
    current_user: User = Depends(require_role("ADMIN", "REGISTRAR")),
    db: AsyncSession = Depends(get_db)
):
    """
    Manually triggers on-demand reconciliation of derived read-model against Sepolia smart contracts.
    Authorized for Registrars and System Administrators.
    """
    try:
        from indexer.reconciliation import ReconciliationEngine
        engine = ReconciliationEngine()
        land_res = await engine.reconcile_lands(db)
        escrow_res = await engine.reconcile_escrows(db)
        return {
            "status": "COMPLETED",
            "lands_reconciled": land_res,
            "escrows_reconciled": escrow_res
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "message": str(e)
        }
