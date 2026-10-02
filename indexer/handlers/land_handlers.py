"""
Indexer Handlers for LandRegistry.sol events
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from backend.app.models.models import Land, LandApplication, Jurisdiction
from indexer.event_parser import ParsedEvent

async def handle_land_registered(session: AsyncSession, event: ParsedEvent):
    land_id = int(event.args["landId"])
    parcel_key = event.args["parcelKey"].lower()
    owner_identity_id = event.args["ownerIdentityId"].lower()
    jurisdiction_id = int(event.args["jurisdictionId"])
    geometry_hash = event.args["geometryHash"].lower()
    manifest_hash = event.args["documentManifestHash"].lower()
    block_num = event.block_number

    # Ensure jurisdiction exists in derived model
    jur_stmt = select(Jurisdiction).where(Jurisdiction.id == jurisdiction_id)
    jur_res = await session.execute(jur_stmt)
    if not jur_res.scalar_one_or_none():
        new_jur = Jurisdiction(
            id=jurisdiction_id,
            name=f"Jurisdiction {jurisdiction_id}",
            state="Maharashtra",
            district="Region"
        )
        session.add(new_jur)
        await session.flush()

    stmt = select(Land).where(Land.land_id == land_id)
    result = await session.execute(stmt)
    land = result.scalar_one_or_none()

    if not land:
        land = Land(
            land_id=land_id,
            parcel_key=parcel_key,
            owner_identity_id=owner_identity_id,
            jurisdiction_id=jurisdiction_id,
            status="PENDING_VERIFICATION",
            geometry_hash=geometry_hash,
            document_manifest_hash=manifest_hash,
            registered_block=block_num
        )
        session.add(land)
    else:
        land.parcel_key = parcel_key
        land.owner_identity_id = owner_identity_id
        land.jurisdiction_id = jurisdiction_id
        land.status = "PENDING_VERIFICATION"
        land.geometry_hash = geometry_hash
        land.document_manifest_hash = manifest_hash
        land.registered_block = block_num

    # Update off-chain application if matching parcelKey
    await session.execute(
        update(LandApplication)
        .where(LandApplication.parcel_key == parcel_key)
        .values(status="REGISTERED_ON_CHAIN")
    )

async def handle_land_verified(session: AsyncSession, event: ParsedEvent):
    land_id = int(event.args["landId"])
    inspector = event.args["inspector"].lower()

    stmt = select(Land).where(Land.land_id == land_id)
    result = await session.execute(stmt)
    land = result.scalar_one_or_none()
    if land:
        land.status = "VERIFIED"
        land.verified_block = event.block_number
        land.verified_by_inspector = inspector

async def handle_land_rejected(session: AsyncSession, event: ParsedEvent):
    land_id = int(event.args["landId"])
    stmt = select(Land).where(Land.land_id == land_id)
    result = await session.execute(stmt)
    land = result.scalar_one_or_none()
    if land:
        land.status = "REJECTED"

async def handle_land_locked(session: AsyncSession, event: ParsedEvent):
    land_id = int(event.args["landId"])
    transfer_id = int(event.args["transferId"])

    stmt = select(Land).where(Land.land_id == land_id)
    result = await session.execute(stmt)
    land = result.scalar_one_or_none()
    if land:
        land.status = "LOCKED_IN_TRANSFER"
        land.active_transfer_id = transfer_id

async def handle_land_unlocked(session: AsyncSession, event: ParsedEvent):
    land_id = int(event.args["landId"])
    stmt = select(Land).where(Land.land_id == land_id)
    result = await session.execute(stmt)
    land = result.scalar_one_or_none()
    if land:
        land.status = "VERIFIED"
        land.active_transfer_id = None

async def handle_ownership_transferred(session: AsyncSession, event: ParsedEvent):
    land_id = int(event.args["landId"])
    new_owner = event.args["newOwner"].lower()

    stmt = select(Land).where(Land.land_id == land_id)
    result = await session.execute(stmt)
    land = result.scalar_one_or_none()
    if land:
        land.owner_identity_id = new_owner
        land.status = "VERIFIED"
        land.active_transfer_id = None
