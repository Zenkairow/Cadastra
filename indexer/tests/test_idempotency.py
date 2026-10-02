import pytest
from sqlalchemy import select

from indexer.event_parser import ParsedEvent
from backend.app.models.models import BlockchainEvent, Land

@pytest.mark.asyncio
async def test_indexer_idempotency_exact_replay(db_session, indexer_instance):
    """
    Validates Master Plan Exit Criterion:
    'Replay the same event batch twice: the database ends in the same state with no duplicates.'
    """
    event = ParsedEvent(
        contract_name="LandRegistry",
        contract_address="0xLandReg",
        event_name="LandRegistered",
        args={
            "landId": 501,
            "parcelKey": "0x" + "77" * 32,
            "ownerIdentityId": "0x" + "88" * 32,
            "jurisdictionId": 101,
            "geometryHash": "0x" + "11" * 32,
            "documentManifestHash": "0x" + "22" * 32
        },
        block_number=200,
        block_hash="0xblock200",
        transaction_hash="0xreplay_tx",
        log_index=1
    )

    # First ingestion
    first_run = await indexer_instance.process_single_event(db_session, event)
    await db_session.commit()
    assert first_run is True

    # Count events and lands after run 1
    events_1 = (await db_session.execute(
        select(BlockchainEvent).where(BlockchainEvent.transaction_hash == "0xreplay_tx")
    )).scalars().all()
    assert len(events_1) == 1

    lands_1 = (await db_session.execute(
        select(Land).where(Land.land_id == 501)
    )).scalars().all()
    assert len(lands_1) == 1

    # Second ingestion (Exact replay of identical event)
    second_run = await indexer_instance.process_single_event(db_session, event)
    await db_session.commit()
    assert second_run is False # Idempotency check detects duplicate and safely skips

    # Count events and lands after run 2: MUST NOT DUPLICATE
    events_2 = (await db_session.execute(
        select(BlockchainEvent).where(BlockchainEvent.transaction_hash == "0xreplay_tx")
    )).scalars().all()
    assert len(events_2) == 1

    lands_2 = (await db_session.execute(
        select(Land).where(Land.land_id == 501)
    )).scalars().all()
    assert len(lands_2) == 1

@pytest.mark.asyncio
async def test_indexer_crash_and_restart_recovery(db_session, indexer_instance):
    """
    Validates Master Plan Exit Criterion:
    'Kill the indexer mid-batch and restart: it resumes with no gap and no duplicate.'
    """
    batch = [
        ParsedEvent(
            contract_name="LandRegistry",
            contract_address="0xLandReg",
            event_name="LandRegistered",
            args={
                "landId": 600 + i,
                "parcelKey": f"0x{i:02x}" + "99" * 31,
                "ownerIdentityId": "0x" + "aa" * 32,
                "jurisdictionId": 101,
                "geometryHash": "0x" + "11" * 32,
                "documentManifestHash": "0x" + "22" * 32
            },
            block_number=210 + i,
            block_hash=f"0xblock{210 + i}",
            transaction_hash=f"0xcrash_tx_{i}",
            log_index=0
        )
        for i in range(5)
    ]

    # Process first 3 events, then "crash"
    for e in batch[:3]:
        await indexer_instance.process_single_event(db_session, e)
    await db_session.commit()

    # Verify first 3 are in database
    evs_mid = (await db_session.execute(
        select(BlockchainEvent).where(BlockchainEvent.transaction_hash.like("0xcrash_tx_%"))
    )).scalars().all()
    assert len(evs_mid) == 3

    # Restart indexer: replay batch starting from item 2 (overlapping item 2, plus remaining items 3 and 4)
    for e in batch[2:]:
        await indexer_instance.process_single_event(db_session, e)
    await db_session.commit()

    # Verify all 5 events present with zero duplicates and zero gaps
    evs_final = (await db_session.execute(
        select(BlockchainEvent).where(BlockchainEvent.transaction_hash.like("0xcrash_tx_%"))
    )).scalars().all()
    assert len(evs_final) == 5

    # Check distinct land records
    for i in range(5):
        land = (await db_session.execute(select(Land).where(Land.land_id == 600 + i))).scalar_one_or_none()
        assert land is not None
