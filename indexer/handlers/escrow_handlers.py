"""
Indexer Handlers for TransferEscrow.sol events
"""
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.models.models import Escrow, AuditLog
from indexer.event_parser import ParsedEvent

def wei_to_eth(wei_val: int) -> Decimal:
    return Decimal(wei_val) / Decimal(10**18)

async def handle_transfer_requested(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    land_id = int(event.args["landId"])
    buyer_id = event.args["buyerIdentityId"].lower()
    seller_id = event.args["sellerIdentityId"].lower()
    price = wei_to_eth(int(event.args["agreedPrice"]))
    expires_at = datetime.fromtimestamp(int(event.args["expiresAt"]), timezone.utc)

    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()

    if not escrow:
        escrow = Escrow(
            request_id=request_id,
            land_id=land_id,
            buyer_identity_id=buyer_id,
            seller_identity_id=seller_id,
            agreed_price=price,
            deposit_amount=Decimal(0),
            state="REQUESTED",
            expires_at=expires_at,
            approval_count=0,
            has_senior_approval=False
        )
        session.add(escrow)
    else:
        escrow.land_id = land_id
        escrow.buyer_identity_id = buyer_id
        escrow.seller_identity_id = seller_id
        escrow.agreed_price = price
        escrow.state = "REQUESTED"
        escrow.expires_at = expires_at

async def handle_escrow_funded(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    buyer_wallet = event.args["buyerWallet"].lower()
    amount = wei_to_eth(int(event.args["amount"]))
    ts = int(event.args.get("timestamp", 0))

    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "FUNDED"
        escrow.buyer_wallet = buyer_wallet
        escrow.deposit_amount = amount
        escrow.funded_at = datetime.fromtimestamp(ts, timezone.utc) if ts else datetime.now(timezone.utc)

async def handle_transfer_under_review(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "UNDER_REVIEW"

async def handle_transfer_approved(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    level = int(event.args["level"])

    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.approval_count = (escrow.approval_count or 0) + 1
        if level <= 2:
            escrow.has_senior_approval = True
        escrow.state = "APPROVED"

async def handle_transfer_completed(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    ts = int(event.args.get("timestamp", 0))

    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "COMPLETED"
        escrow.settled_at = datetime.fromtimestamp(ts, timezone.utc) if ts else datetime.now(timezone.utc)

async def handle_transfer_cancelled(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    reason = event.args.get("reason", "")

    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "CANCELLED"
        escrow.cancellation_reason = reason

async def handle_transfer_rejected(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    reason = event.args.get("reason", "")

    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "REJECTED"
        escrow.rejection_reason = reason

async def handle_transfer_expired(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "EXPIRED"

async def handle_transfer_refunded(session: AsyncSession, event: ParsedEvent):
    request_id = int(event.args["requestId"])
    stmt = select(Escrow).where(Escrow.request_id == request_id)
    result = await session.execute(stmt)
    escrow = result.scalar_one_or_none()
    if escrow:
        escrow.state = "REFUNDED"

async def handle_funds_withdrawn(session: AsyncSession, event: ParsedEvent):
    recipient = event.args["recipient"].lower()
    amount = wei_to_eth(int(event.args["amount"]))

    audit = AuditLog(
        action="ESCROW_PULL_PAYMENT_WITHDRAWN",
        actor_wallet=recipient,
        details={"amount_eth": float(amount), "tx_hash": event.transaction_hash}
    )
    session.add(audit)
