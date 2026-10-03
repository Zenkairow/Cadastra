from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime

from backend.app.database import get_db
from backend.app.schemas.schemas import NonceResponse, VerifySignatureRequest, TokenResponse, UserResponse
from backend.app.services.auth_service import auth_service
from backend.app.services.kyc_adapter import kyc_adapter
from backend.app.models.models import User, WalletBinding
from backend.app.api.dependencies import get_current_user

from backend.app.api.rate_limiter import auth_rate_limiter

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.get("/nonce", response_model=NonceResponse, dependencies=[Depends(auth_rate_limiter)])
async def get_login_nonce(wallet_address: str = Query(..., pattern=r"^0x[a-fA-F0-9]{40}$")):
    """Issue a cryptographically random, single-use nonce for wallet challenge signature."""
    nonce, issued_at, expires_at = auth_service.generate_nonce(wallet_address)
    return NonceResponse(nonce=nonce, issued_at=issued_at, expires_at=expires_at)

@router.post("/verify", response_model=TokenResponse, dependencies=[Depends(auth_rate_limiter)])
async def verify_signature(req: VerifySignatureRequest, db: AsyncSession = Depends(get_db)):

    """
    Verifies EIP-4361 SIWE signature, checks single-use nonce, and resolves user session.
    Automatically generates onboarding profile if first-time visitor.
    """
    try:
        recovered_wallet, validated_nonce = auth_service.verify_siwe_signature(
            message=req.message,
            signature=req.signature
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Look up user by active wallet
    stmt = select(User).where(User.active_wallet == recovered_wallet)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        # Create initial platform profile
        mock_id, mock_kyc_ref = kyc_adapter.verify_citizen(
            national_id=recovered_wallet[-6:],
            full_name=f"USER_{recovered_wallet[-4:]}"
        )
        user = User(
            identity_id=mock_id,
            active_wallet=recovered_wallet,
            role="CITIZEN",
            kyc_status="VERIFIED",
            kyc_reference=mock_kyc_ref
        )
        db.add(user)

        # Add wallet binding
        binding = WalletBinding(
            identity_id=mock_id,
            wallet_address=recovered_wallet,
            status="ACTIVE"
        )
        db.add(binding)
        await db.commit()
        await db.refresh(user)

    # Issue JWT token
    token = auth_service.create_access_token(
        identity_id=user.identity_id,
        wallet_address=user.active_wallet,
        role=user.role
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )

@router.get("/me", response_model=UserResponse)
async def get_current_profile(current_user: User = Depends(get_current_user)):
    """Fetch profile of authenticated user."""
    return UserResponse.model_validate(current_user)
