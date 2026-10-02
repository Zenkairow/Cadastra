"""
Indexer Handlers for IdentityRegistry.sol events
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime, timezone

from backend.app.models.models import User, WalletBinding
from indexer.event_parser import ParsedEvent

async def handle_identity_bound(session: AsyncSession, event: ParsedEvent):
    identity_id = event.args["identityId"].lower()
    wallet = event.args["wallet"].lower()

    # Find or create user
    stmt = select(User).where(User.identity_id == identity_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            identity_id=identity_id,
            active_wallet=wallet,
            role="CITIZEN",
            kyc_status="VERIFIED"
        )
        session.add(user)
    else:
        user.active_wallet = wallet
        user.kyc_status = "VERIFIED"

    # Deactivate existing active bindings for this identity
    await session.execute(
        update(WalletBinding)
        .where(WalletBinding.identity_id == identity_id, WalletBinding.status == "ACTIVE")
        .values(status="REVOKED", revoked_at=datetime.now(timezone.utc))
    )

    # Add new active binding
    binding = WalletBinding(
        identity_id=identity_id,
        wallet_address=wallet,
        status="ACTIVE"
    )
    session.add(binding)

async def handle_wallet_recovered(session: AsyncSession, event: ParsedEvent):
    identity_id = event.args["identityId"].lower()
    old_wallet = event.args["oldWallet"].lower()
    new_wallet = event.args["newWallet"].lower()

    # Update active wallet on user
    stmt = select(User).where(User.identity_id == identity_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if user:
        user.active_wallet = new_wallet

    # Revoke old binding
    await session.execute(
        update(WalletBinding)
        .where(WalletBinding.identity_id == identity_id, WalletBinding.wallet_address == old_wallet)
        .values(status="REVOKED", revoked_at=datetime.now(timezone.utc))
    )

    # Insert new active binding
    new_binding = WalletBinding(
        identity_id=identity_id,
        wallet_address=new_wallet,
        status="ACTIVE"
    )
    session.add(new_binding)

async def handle_wallet_revoked(session: AsyncSession, event: ParsedEvent):
    identity_id = event.args["identityId"].lower()
    wallet = event.args["wallet"].lower()

    stmt = select(User).where(User.identity_id == identity_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if user and user.active_wallet == wallet:
        user.active_wallet = None

    await session.execute(
        update(WalletBinding)
        .where(WalletBinding.identity_id == identity_id, WalletBinding.wallet_address == wallet)
        .values(status="REVOKED", revoked_at=datetime.now(timezone.utc))
    )
