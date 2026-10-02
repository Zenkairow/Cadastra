from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional

from backend.app.database import get_db
from backend.app.models.models import Land
from backend.app.schemas.schemas import LandItemResponse, PaginatedLandResponse

router = APIRouter(prefix="/lands", tags=["Lands Read-Model"])

@router.get("", response_model=PaginatedLandResponse)
async def list_registered_lands(
    jurisdiction_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Fast, paginated search and filter across registered lands served from PostgreSQL.
    Guarantees: Zero direct sequential blockchain RPC round-trips.
    """
    stmt = select(Land)
    count_stmt = select(func.count(Land.land_id))

    if jurisdiction_id:
        stmt = stmt.where(Land.jurisdiction_id == jurisdiction_id)
        count_stmt = count_stmt.where(Land.jurisdiction_id == jurisdiction_id)

    if status_filter:
        stmt = stmt.where(Land.status == status_filter)
        count_stmt = count_stmt.where(Land.status == status_filter)

    total = (await db.execute(count_stmt)).scalar() or 0
    
    offset = (page - 1) * size
    stmt = stmt.offset(offset).limit(size).order_by(Land.land_id.desc())
    items = (await db.execute(stmt)).scalars().all()

    return PaginatedLandResponse(
        total=total,
        page=page,
        size=size,
        items=[LandItemResponse.model_validate(item) for item in items]
    )

@router.get("/{land_id}", response_model=LandItemResponse)
async def get_land_detail(land_id: int, db: AsyncSession = Depends(get_db)):
    """Fetch authoritative registered land details from the derived read-model."""
    stmt = select(Land).where(Land.land_id == land_id)
    land = (await db.execute(stmt)).scalar_one_or_none()

    if not land:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Land parcel not found")

    return LandItemResponse.model_validate(land)
