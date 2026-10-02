"""
Indexer Handlers for InspectorRegistry.sol events
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from backend.app.models.models import Inspector, User
from indexer.event_parser import ParsedEvent

LEVEL_ROLES = {
    0: "ADMIN",
    1: "REGISTRAR",
    2: "SENIOR_INSPECTOR",
    3: "INSPECTOR"
}

async def handle_inspector_added(session: AsyncSession, event: ParsedEvent):
    wallet = event.args["wallet"].lower()
    level = int(event.args["level"])
    jurisdiction_id = int(event.args["jurisdictionId"])
    valid_until = int(event.args["validUntil"])
    appointed_by = event.args.get("appointedBy", "").lower()

    stmt = select(Inspector).where(Inspector.address == wallet)
    result = await session.execute(stmt)
    inspector = result.scalar_one_or_none()

    if not inspector:
        inspector = Inspector(
            address=wallet,
            level=level,
            jurisdiction_id=jurisdiction_id,
            is_active=True,
            valid_until=valid_until,
            appointed_by=appointed_by
        )
        session.add(inspector)
    else:
        inspector.level = level
        inspector.jurisdiction_id = jurisdiction_id
        inspector.is_active = True
        inspector.valid_until = valid_until
        inspector.appointed_by = appointed_by

    # Update role in User table if user exists
    user_stmt = select(User).where(User.active_wallet == wallet)
    user_res = await session.execute(user_stmt)
    user = user_res.scalar_one_or_none()
    if user:
        user.role = LEVEL_ROLES.get(level, "INSPECTOR")

async def handle_inspector_revoked(session: AsyncSession, event: ParsedEvent):
    wallet = event.args["wallet"].lower()
    stmt = select(Inspector).where(Inspector.address == wallet)
    result = await session.execute(stmt)
    inspector = result.scalar_one_or_none()
    if inspector:
        inspector.is_active = False

    user_stmt = select(User).where(User.active_wallet == wallet)
    user_res = await session.execute(user_stmt)
    user = user_res.scalar_one_or_none()
    if user:
        user.role = "CITIZEN"

async def handle_inspector_level_changed(session: AsyncSession, event: ParsedEvent):
    wallet = event.args["wallet"].lower()
    new_level = int(event.args["newLevel"])
    stmt = select(Inspector).where(Inspector.address == wallet)
    result = await session.execute(stmt)
    inspector = result.scalar_one_or_none()
    if inspector:
        inspector.level = new_level

    user_stmt = select(User).where(User.active_wallet == wallet)
    user_res = await session.execute(user_stmt)
    user = user_res.scalar_one_or_none()
    if user:
        user.role = LEVEL_ROLES.get(new_level, "INSPECTOR")

async def handle_inspector_jurisdiction_changed(session: AsyncSession, event: ParsedEvent):
    wallet = event.args["wallet"].lower()
    new_jurisdiction = int(event.args["newJurisdiction"])
    stmt = select(Inspector).where(Inspector.address == wallet)
    result = await session.execute(stmt)
    inspector = result.scalar_one_or_none()
    if inspector:
        inspector.jurisdiction_id = new_jurisdiction
