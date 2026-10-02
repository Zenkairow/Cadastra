from typing import Callable, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from indexer.event_parser import ParsedEvent

from indexer.handlers.identity_handlers import (
    handle_identity_bound,
    handle_wallet_recovered,
    handle_wallet_revoked
)
from indexer.handlers.inspector_handlers import (
    handle_inspector_added,
    handle_inspector_revoked,
    handle_inspector_level_changed,
    handle_inspector_jurisdiction_changed
)
from indexer.handlers.land_handlers import (
    handle_land_registered,
    handle_land_verified,
    handle_land_rejected,
    handle_land_locked,
    handle_land_unlocked,
    handle_ownership_transferred
)
from indexer.handlers.escrow_handlers import (
    handle_transfer_requested,
    handle_escrow_funded,
    handle_transfer_under_review,
    handle_transfer_approved,
    handle_transfer_completed,
    handle_transfer_cancelled,
    handle_transfer_rejected,
    handle_transfer_expired,
    handle_transfer_refunded,
    handle_funds_withdrawn
)

EVENT_DISPATCHER: Dict[str, Callable[[AsyncSession, ParsedEvent], None]] = {
    # Identity Events
    "IdentityBound": handle_identity_bound,
    "WalletRecovered": handle_wallet_recovered,
    "WalletRevoked": handle_wallet_revoked,

    # Inspector Events
    "InspectorAdded": handle_inspector_added,
    "InspectorRevoked": handle_inspector_revoked,
    "InspectorLevelChanged": handle_inspector_level_changed,
    "InspectorJurisdictionChanged": handle_inspector_jurisdiction_changed,

    # Land Events
    "LandRegistered": handle_land_registered,
    "LandVerified": handle_land_verified,
    "LandRejected": handle_land_rejected,
    "LandLockedForTransfer": handle_land_locked,
    "LandUnlockedFromTransfer": handle_land_unlocked,
    "OwnershipTransferred": handle_ownership_transferred,

    # Escrow Events
    "TransferRequested": handle_transfer_requested,
    "EscrowFunded": handle_escrow_funded,
    "TransferUnderReview": handle_transfer_under_review,
    "TransferApproved": handle_transfer_approved,
    "TransferCompleted": handle_transfer_completed,
    "TransferCancelled": handle_transfer_cancelled,
    "TransferRejected": handle_transfer_rejected,
    "TransferExpired": handle_transfer_expired,
    "TransferRefunded": handle_transfer_refunded,
    "FundsWithdrawn": handle_funds_withdrawn,
}

async def dispatch_event(session: AsyncSession, event: ParsedEvent) -> bool:
    """Dispatches parsed event to its dedicated handler. Returns True if handled."""
    handler = EVENT_DISPATCHER.get(event.event_name)
    if handler:
        await handler(session, event)
        return True
    return False
