import pytest
from unittest.mock import MagicMock
from sqlalchemy import select

from backend.app.models.models import Land, Escrow, AuditLog
from indexer.reconciliation import reconciliation_engine

@pytest.mark.asyncio
async def test_reconciliation_detects_and_repairs_tampered_land(db_session):
    """
    Validates Master Plan Exit Criterion:
    'A manually altered derived row is detected and repaired by reconciliation.'
    """
    real_owner = "0x" + "11" * 32
    tampered_owner = "0x" + "99" * 32
    land_id = 888

    # 1. Insert land record in database
    land = Land(
        land_id=land_id,
        parcel_key="0x" + "aa" * 32,
        owner_identity_id=real_owner.lower(),
        jurisdiction_id=101,
        status="VERIFIED",
        geometry_hash="0x" + "bb" * 32,
        document_manifest_hash="0x" + "cc" * 32,
        registered_block=100
    )
    db_session.add(land)
    await db_session.commit()

    # 2. Simulate manual database tampering (an unauthorized update bypasses blockchain)
    land.owner_identity_id = tampered_owner.lower()
    land.status = "REJECTED"
    await db_session.commit()

    # 3. Setup mock LandRegistry contract returning on-chain ground truth
    # getLand tuple: (parcelKey, ownerIdentityId, jurisdictionId, status, geometryHash, documentManifestHash, registeredAt, verifiedAt, activeTransferId)
    mock_contract = MagicMock()
    mock_contract.functions.getLand(land_id).call.return_value = (
        bytes.fromhex("aa" * 32),
        bytes.fromhex("11" * 32), # Real owner on-chain
        101,
        1, # VERIFIED status on-chain
        bytes.fromhex("bb" * 32),
        bytes.fromhex("cc" * 32),
        1700000000,
        1700000100,
        0
    )

    # 4. Execute Reconciliation
    report = await reconciliation_engine.reconcile_lands(db_session, land_contract_instance=mock_contract)

    assert report["checked"] == 1
    assert report["mismatches"] == 1
    assert report["repaired"] == 1

    # 5. Verify database has been self-healed
    await db_session.refresh(land)
    assert land.owner_identity_id == real_owner.lower()
    assert land.status == "VERIFIED"

    # 6. Verify audit logs record both detection and automated repair
    logs = (await db_session.execute(
        select(AuditLog).where(AuditLog.action.in_(["SYNC_ERROR_DETECTED", "SYNC_ERROR_REPAIRED"]))
    )).scalars().all()
    assert len(logs) == 2

@pytest.mark.asyncio
async def test_reconciliation_detects_and_repairs_tampered_escrow(db_session):
    request_id = 99
    land_id = 888

    escrow = Escrow(
        request_id=request_id,
        land_id=land_id,
        buyer_identity_id="0x" + "22" * 32,
        seller_identity_id="0x" + "33" * 32,
        agreed_price=3.5,
        state="APPROVED",
        expires_at=None
    )
    # expires_at is required in model, let's provide dummy
    from datetime import datetime, timezone
    escrow.expires_at = datetime.now(timezone.utc)
    db_session.add(escrow)
    await db_session.commit()

    # Tamper with escrow state
    escrow.state = "CANCELLED"
    await db_session.commit()

    # Mock TransferEscrow contract
    # getRequest returns: (requestId, landId, buyerIdentityId, sellerIdentityId, agreedPrice, depositAmount, createdAt, expiresAt, state, approvalCount, hasSeniorApproval)
    mock_escrow = MagicMock()
    mock_escrow.functions.getRequest(request_id).call.return_value = (
        request_id,
        land_id,
        bytes.fromhex("22" * 32),
        bytes.fromhex("33" * 32),
        int(3.5 * 10**18),
        int(3.5 * 10**18),
        1700000000,
        1700000500,
        3, # APPROVED on-chain
        2,
        True
    )

    report = await reconciliation_engine.reconcile_escrows(db_session, escrow_contract_instance=mock_escrow)
    assert report["mismatches"] == 1
    assert report["repaired"] == 1

    await db_session.refresh(escrow)
    assert escrow.state == "APPROVED"
