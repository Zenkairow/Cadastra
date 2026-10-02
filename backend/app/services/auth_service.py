import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Tuple
import jwt
import re
from eth_account import Account
from eth_account.messages import encode_defunct

from backend.app.config import settings

class AuthService:
    def __init__(self):
        # In-memory single-use nonce store: nonce -> {wallet, issued_at, expires_at}
        self._nonce_store: Dict[str, Dict] = {}

    def generate_nonce(self, wallet_address: str) -> Tuple[str, datetime, datetime]:
        """Generates a cryptographically random, single-use nonce with 5-minute expiry."""
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=settings.NONCE_EXPIRE_SECONDS)
        nonce = str(uuid.uuid4())

        self._nonce_store[nonce] = {
            "wallet": wallet_address.lower(),
            "issued_at": now,
            "expires_at": expires_at,
        }
        return nonce, now, expires_at

    def verify_siwe_signature(self, message: str, signature: str) -> Tuple[str, str]:
        """
        Validates EIP-4361 SIWE message components and ECDSA signature.
        Returns (recovered_wallet, validated_nonce).
        """
        # Parse SIWE message components
        nonce_match = re.search(r"Nonce:\s*([a-fA-F0-9\-]+)", message)
        chain_match = re.search(r"Chain ID:\s*(\d+)", message)
        domain_match = re.search(r"^([^\s]+)\s+wants you to sign in", message)
        wallet_match = re.search(r"(0x[a-fA-F0-9]{40})", message)

        if not nonce_match or not chain_match or not wallet_match:
            raise ValueError("Malformed SIWE message format")

        nonce = nonce_match.group(1).strip()
        chain_id = int(chain_match.group(1).strip())
        claimed_wallet = wallet_match.group(1).strip().lower()

        # 1. Enforce Sepolia Chain ID (11155111)
        if chain_id != settings.CHAIN_ID:
            raise ValueError(f"Invalid Chain ID. Expected {settings.CHAIN_ID}, got {chain_id}")

        # 2. Validate Nonce freshness & single-use constraint
        nonce_record = self._nonce_store.get(nonce)
        if not nonce_record:
            raise ValueError("Nonce not found or already consumed (Replay attack prevented)")

        now = datetime.now(timezone.utc)
        if now > nonce_record["expires_at"]:
            del self._nonce_store[nonce]
            raise ValueError("Authentication challenge nonce has expired")

        if nonce_record["wallet"] != claimed_wallet:
            raise ValueError("Nonce was issued for a different wallet address")

        # Invalidate nonce immediately (single-use guarantee)
        del self._nonce_store[nonce]

        # 3. Recover address from ECDSA signature
        signable_message = encode_defunct(text=message)
        try:
            recovered_wallet = Account.recover_message(signable_message, signature=signature).lower()
        except Exception as e:
            raise ValueError(f"Invalid cryptographic signature: {str(e)}")

        if recovered_wallet != claimed_wallet:
            raise ValueError(f"Signature mismatch. Claimed: {claimed_wallet}, Recovered: {recovered_wallet}")

        return recovered_wallet, nonce

    def create_access_token(self, identity_id: str, wallet_address: str, role: str) -> str:
        """Issues short-lived JWT encoding identity, active wallet, and role."""
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)

        payload = {
            "sub": identity_id,
            "wallet": wallet_address.lower(),
            "role": role,
            "iat": now,
            "exp": expires_at,
        }

        return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    def decode_access_token(self, token: str) -> Dict:
        """Decodes and verifies JWT bearer token."""
        try:
            return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise ValueError("Token has expired")
        except jwt.InvalidTokenError:
            raise ValueError("Invalid access token")

auth_service = AuthService()
