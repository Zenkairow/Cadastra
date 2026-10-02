from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional

from backend.app.database import get_db
from backend.app.models.models import Escrow
from backend.app.schemas.schemas import EscrowItemResponse

router = APIRouter(prefix="/escrows", tags=["Escrow Read-Model"])

@router.get("", response_model=List[EscrowItemResponse])
async def list_escrows(
    land_id: Optional[int] = Query(None),
    state: Optional[str] = Query(None),
    buyer_identity_id: Optional[str] = Query(None),
    seller_identity_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Query transfer escrows from the derived read-model.
    Guarantees: Zero direct sequential blockchain RPC round-trips for list/dashboard rendering.
    """
    stmt = select(Escrow)
    if land_id is not None:
        stmt = stmt.where(Escrow.land_id == land_id)
    if state:
        stmt = stmt.where(Escrow.state == state.upper())
    if buyer_identity_id:
        stmt = stmt.where(Escrow.buyer_identity_id == buyer_identity_id.lower())
    if seller_identity_id:
        stmt = stmt.where(Escrow.seller_identity_id == seller_identity_id.lower())

    stmt = stmt.order_by(Escrow.request_id.desc())
    items = (await db.execute(stmt)).scalars().all()
    return [EscrowItemResponse.model_validate(item) for item in items]

@router.get("/{request_id}", response_model=EscrowItemResponse)
async def get_escrow(request_id: int, db: AsyncSession = Depends(get_db)):
    """Fetch authoritative escrow state for a given transfer request ID."""
    stmt = select(Escrow).where(Escrow.request_id == request_id)
    escrow = (await db.execute(stmt)).scalar_one_or_none()
    if not escrow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Escrow request not found")
    return EscrowItemResponse.model_validate(escrow)
