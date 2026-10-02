import pytest
from sqlalchemy import select
from datetime import datetime, timezone

from indexer.event_parser import ParsedEvent
from indexer.handlers import dispatch_event
from backend.app.models.models import User, WalletBinding, Inspector, Land, Escrow

@pytest.mark.asyncio
async def test_identity_event_handlers(db_session):
    identity_id = "0x" + "aa" * 32
    wallet1 = "0x1111111111111111111111111111111111111111"
    wallet2 = "0x2222222222222222222222222222222222222222"

    # 1. IdentityBound
    event_bound = ParsedEvent(
        contract_name="IdentityRegistry",
        contract_address="0xIdentityReg",
        event_name="IdentityBound",
        args={"identityId": identity_id, "wallet": wallet1, "timestamp": 1700000000},
        block_number=100,
        block_hash="0xblock100",
        transaction_hash="0xtx1",
        log_index=0
    )
    handled = await dispatch_event(db_session, event_bound)
    assert handled is True
    await db_session.commit()

    user = (await db_session.execute(select(User).where(User.identity_id == identity_id))).scalar_one()
    assert user.active_wallet == wallet1.lower()
    assert user.kyc_status == "VERIFIED"

    binding = (await db_session.execute(
        select(WalletBinding).where(WalletBinding.identity_id == identity_id, WalletBinding.wallet_address == wallet1.lower())
    )).scalar_one()
    assert binding.status == "ACTIVE"

    # 2. WalletRecovered
    event_rec = ParsedEvent(
        contract_name="IdentityRegistry",
        contract_address="0xIdentityReg",
        event_name="WalletRecovered",
        args={"identityId": identity_id, "oldWallet": wallet1, "newWallet": wallet2, "timestamp": 1700000100},
        block_number=101,
        block_hash="0xblock101",
        transaction_hash="0xtx2",
        log_index=0
    )
    await dispatch_event(db_session, event_rec)
    await db_session.commit()

    await db_session.refresh(user)
    assert user.active_wallet == wallet2.lower()

    old_b = (await db_session.execute(
        select(WalletBinding).where(WalletBinding.identity_id == identity_id, WalletBinding.wallet_address == wallet1.lower())
    )).scalar_one()
    assert old_b.status == "REVOKED"

    new_b = (await db_session.execute(
        select(WalletBinding).where(WalletBinding.identity_id == identity_id, WalletBinding.wallet_address == wallet2.lower())
    )).scalar_one()
    assert new_b.status == "ACTIVE"

@pytest.mark.asyncio
async def test_inspector_event_handlers(db_session):
    inspector_wallet = "0x3333333333333333333333333333333333333333"

    # 1. InspectorAdded
    event_add = ParsedEvent(
        contract_name="InspectorRegistry",
        contract_address="0xInspectorReg",
        event_name="InspectorAdded",
        args={
            "wallet": inspector_wallet,
            "level": 2, # Senior Inspector
            "jurisdictionId": 101,
            "validUntil": 1800000000,
            "appointedBy": "0xadmin"
        },
        block_number=102,
        block_hash="0xblock102",
        transaction_hash="0xtx3",
        log_index=0
    )
    await dispatch_event(db_session, event_add)
    await db_session.commit()

    insp = (await db_session.execute(select(Inspector).where(Inspector.address == inspector_wallet.lower()))).scalar_one()
    assert insp.level == 2
    assert insp.jurisdiction_id == 101
    assert insp.is_active is True

    # 2. InspectorRevoked
    event_revoke = ParsedEvent(
        contract_name="InspectorRegistry",
        contract_address="0xInspectorReg",
        event_name="InspectorRevoked",
        args={"wallet": inspector_wallet, "revokedBy": "0xadmin"},
        block_number=103,
        block_hash="0xblock103",
        transaction_hash="0xtx4",
        log_index=0
    )
    await dispatch_event(db_session, event_revoke)
    await db_session.commit()

    await db_session.refresh(insp)
    assert insp.is_active is False

@pytest.mark.asyncio
async def test_land_event_handlers(db_session):
    land_id = 999
    parcel_key = "0x" + "bb" * 32
    owner_id = "0x" + "cc" * 32
    new_owner_id = "0x" + "dd" * 32
    geom_hash = "0x" + "ee" * 32
    manifest_hash = "0x" + "ff" * 32

    # 1. LandRegistered
    event_reg = ParsedEvent(
        contract_name="LandRegistry",
        contract_address="0xLandReg",
        event_name="LandRegistered",
        args={
            "landId": land_id,
            "parcelKey": parcel_key,
            "ownerIdentityId": owner_id,
            "jurisdictionId": 101,
            "geometryHash": geom_hash,
            "documentManifestHash": manifest_hash
        },
        block_number=104,
        block_hash="0xblock104",
        transaction_hash="0xtx5",
        log_index=0
    )
    await dispatch_event(db_session, event_reg)
    await db_session.commit()

    land = (await db_session.execute(select(Land).where(Land.land_id == land_id))).scalar_one()
    assert land.status == "PENDING_VERIFICATION"
    assert land.owner_identity_id == owner_id.lower()
    assert land.parcel_key == parcel_key.lower()

    # 2. LandVerified
    event_ver = ParsedEvent(
        contract_name="LandRegistry",
        contract_address="0xLandReg",
        event_name="LandVerified",
        args={"landId": land_id, "inspector": "0xInspectorWallet"},
        block_number=105,
        block_hash="0xblock105",
        transaction_hash="0xtx6",
        log_index=0
    )
    await dispatch_event(db_session, event_ver)
    await db_session.commit()

    await db_session.refresh(land)
    assert land.status == "VERIFIED"
    assert land.verified_by_inspector == "0xinspectorwallet"

    # 3. OwnershipTransferred
    event_trans = ParsedEvent(
        contract_name="LandRegistry",
        contract_address="0xLandReg",
        event_name="OwnershipTransferred",
        args={
            "landId": land_id,
            "previousOwner": owner_id,
            "newOwner": new_owner_id
        },
        block_number=106,
        block_hash="0xblock106",
        transaction_hash="0xtx7",
        log_index=0
    )
    await dispatch_event(db_session, event_trans)
    await db_session.commit()

    await db_session.refresh(land)
    assert land.owner_identity_id == new_owner_id.lower()

@pytest.mark.asyncio
async def test_escrow_event_handlers(db_session):
    request_id = 55
    land_id = 999
    buyer_id = "0x" + "11" * 32
    seller_id = "0x" + "22" * 32
    buyer_wallet = "0x4444444444444444444444444444444444444444"

    # 1. TransferRequested (2 ETH)
    event_req = ParsedEvent(
        contract_name="TransferEscrow",
        contract_address="0xEscrow",
        event_name="TransferRequested",
        args={
            "requestId": request_id,
            "landId": land_id,
            "buyerIdentityId": buyer_id,
            "sellerIdentityId": seller_id,
            "agreedPrice": 2 * 10**18,
            "expiresAt": 1750000000
        },
        block_number=107,
        block_hash="0xblock107",
        transaction_hash="0xtx8",
        log_index=0
    )
    await dispatch_event(db_session, event_req)
    await db_session.commit()

    esc = (await db_session.execute(select(Escrow).where(Escrow.request_id == request_id))).scalar_one()
    assert esc.state == "REQUESTED"
    assert esc.agreed_price == 2.0

    # 2. EscrowFunded
    event_fund = ParsedEvent(
        contract_name="TransferEscrow",
        contract_address="0xEscrow",
        event_name="EscrowFunded",
        args={
            "requestId": request_id,
            "buyerWallet": buyer_wallet,
            "amount": 2 * 10**18,
            "timestamp": 1700000050
        },
        block_number=108,
        block_hash="0xblock108",
        transaction_hash="0xtx9",
        log_index=0
    )
    await dispatch_event(db_session, event_fund)
    await db_session.commit()

    await db_session.refresh(esc)
    assert esc.state == "FUNDED"
    assert esc.deposit_amount == 2.0
    assert esc.buyer_wallet == buyer_wallet.lower()

    # 3. TransferApproved (Senior Inspector level 2)
    event_app = ParsedEvent(
        contract_name="TransferEscrow",
        contract_address="0xEscrow",
        event_name="TransferApproved",
        args={
            "requestId": request_id,
            "inspector": "0xSeniorInsp",
            "level": 2
        },
        block_number=109,
        block_hash="0xblock109",
        transaction_hash="0xtx10",
        log_index=0
    )
    await dispatch_event(db_session, event_app)
    await db_session.commit()

    await db_session.refresh(esc)
    assert esc.state == "APPROVED"
    assert esc.has_senior_approval is True
    assert esc.approval_count == 1

    # 4. TransferCompleted
    event_comp = ParsedEvent(
        contract_name="TransferEscrow",
        contract_address="0xEscrow",
        event_name="TransferCompleted",
        args={
            "requestId": request_id,
            "landId": land_id,
            "buyerIdentityId": buyer_id,
            "sellerIdentityId": seller_id,
            "agreedPrice": 2 * 10**18,
            "timestamp": 1700000200
        },
        block_number=110,
        block_hash="0xblock110",
        transaction_hash="0xtx11",
        log_index=0
    )
    await dispatch_event(db_session, event_comp)
    await db_session.commit()

    await db_session.refresh(esc)
    assert esc.state == "COMPLETED"
    assert esc.settled_at is not None
