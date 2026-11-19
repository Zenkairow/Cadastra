from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from backend.app.database import get_db
from backend.app.models.models import Escrow, Land
from backend.app.schemas.schemas import EscrowItemResponse, CreateEscrowRequest, UpdateEscrowRequest

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

@router.post("", response_model=EscrowItemResponse, status_code=status.HTTP_201_CREATED)
async def create_escrow(payload: CreateEscrowRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new transfer escrow request in the read-model.
    Locks the parcel for transfer and records buyer/seller parameters.
    """
    # Verify land exists
    land_stmt = select(Land).where(Land.land_id == payload.land_id)
    land = (await db.execute(land_stmt)).scalar_one_or_none()
    if not land:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Land parcel not found")

    # Determine next request_id
    max_id_stmt = select(func.coalesce(func.max(Escrow.request_id), 0))
    next_id = int((await db.execute(max_id_stmt)).scalar() or 0) + 1

    duration = payload.duration_days or 14
    expires_at = datetime.now(timezone.utc) + timedelta(days=duration)

    escrow = Escrow(
        request_id=next_id,
        land_id=payload.land_id,
        buyer_identity_id=payload.buyer_identity_id.lower(),
        seller_identity_id=payload.seller_identity_id.lower(),
        buyer_wallet=payload.buyer_wallet.lower() if payload.buyer_wallet else None,
        agreed_price=payload.agreed_price,
        deposit_amount=0,
        state="REQUESTED",
        approval_count=0,
        has_senior_approval=False,
        expires_at=expires_at,
    )
    db.add(escrow)

    # Lock the land
    land.status = "LOCKED_IN_TRANSFER"
    land.active_transfer_id = next_id

    await db.commit()
    await db.refresh(escrow)
    return EscrowItemResponse.model_validate(escrow)

@router.patch("/{request_id}", response_model=EscrowItemResponse)
async def update_escrow(request_id: int, payload: UpdateEscrowRequest, db: AsyncSession = Depends(get_db)):
    """
    Update escrow state (FUNDING, REVIEW, APPROVAL, SETTLEMENT, or REJECTION).
    Synchronizes land parcel status upon settlement or rejection.
    """
    stmt = select(Escrow).where(Escrow.request_id == request_id)
    escrow = (await db.execute(stmt)).scalar_one_or_none()
    if not escrow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Escrow request not found")

    land_stmt = select(Land).where(Land.land_id == escrow.land_id)
    land = (await db.execute(land_stmt)).scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if payload.state:
        new_state = payload.state.upper()
        escrow.state = new_state

        if new_state == "FUNDED":
            escrow.funded_at = now
            escrow.deposit_amount = payload.deposit_amount if payload.deposit_amount is not None else escrow.agreed_price
        elif new_state == "APPROVED":
            escrow.approval_count = (escrow.approval_count or 0) + 1
            if payload.has_senior_approval is not None:
                escrow.has_senior_approval = payload.has_senior_approval
        elif new_state == "COMPLETED":
            escrow.settled_at = now
            if land:
                land.owner_identity_id = escrow.buyer_identity_id
                land.status = "VERIFIED"
                land.active_transfer_id = None
        elif new_state in ["REJECTED", "CANCELLED"]:
            if payload.rejection_reason:
                escrow.rejection_reason = payload.rejection_reason
            if land:
                land.status = "VERIFIED"
                land.active_transfer_id = None

    if payload.deposit_amount is not None:
        escrow.deposit_amount = payload.deposit_amount
    if payload.has_senior_approval is not None:
        escrow.has_senior_approval = payload.has_senior_approval
    if payload.approval_count is not None:
        escrow.approval_count = payload.approval_count
    if payload.rejection_reason is not None:
        escrow.rejection_reason = payload.rejection_reason

    await db.commit()
    await db.refresh(escrow)
    return EscrowItemResponse.model_validate(escrow)
