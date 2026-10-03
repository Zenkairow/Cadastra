import pytest
from httpx import AsyncClient, ASGITransport
import io
import time
from sqlalchemy import select

from backend.app.main import app
from backend.app.services.document_security import sanitize_filename, validate_document_security
from backend.app.api.rate_limiter import auth_rate_limiter, upload_rate_limiter
from backend.app.models.models import User, Land, LandApplication, Document
from backend.app.services.auth_service import auth_service
from eth_account.messages import encode_defunct


@pytest.mark.asyncio
async def test_rate_limiting_enforcement():
    """Verify in-memory sliding-window rate limiter returns HTTP 429 upon threshold breach."""
    auth_rate_limiter.clear()
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Send requests up to the limit (15 requests)
        for i in range(15):
            res = await client.get("/api/v1/auth/nonce?wallet_address=0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
            assert res.status_code == 200

        # The 16th request must trigger HTTP 429 Too Many Requests
        rate_limited_res = await client.get("/api/v1/auth/nonce?wallet_address=0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
        assert rate_limited_res.status_code == 429
        assert "Rate limit exceeded" in rate_limited_res.json()["detail"]
        assert "Retry-After" in rate_limited_res.headers

    auth_rate_limiter.clear()

def test_filename_path_traversal_sanitization():
    """Verify filename sanitization prevents directory traversal and null-byte injection."""
    cases = [
        ("../../etc/passwd", "passwd"),
        ("..\\..\\windows\\system32\\cmd.exe", "cmd.exe"),
        ("../../../var/log/syslog.pdf", "syslog.pdf"),
        ("legal_deed\x00.exe", "legal_deed.exe"),
        ("my document ../../test.pdf", "test.pdf"),
        ("", "unnamed_document"),
        ("valid_deed.pdf", "valid_deed.pdf"),
    ]

    for dirty, expected in cases:
        sanitized = sanitize_filename(dirty)
        assert ".." not in sanitized
        assert "/" not in sanitized
        assert "\\" not in sanitized
        assert "\x00" not in sanitized
        assert sanitized == expected

def test_magic_byte_mime_spoofing_defense():
    """Verify that executable scripts masquerading as PDFs are rejected."""
    fake_exe_bytes = b"MZ\x90\x00\x03\x00\x00\x00"
    
    with pytest.raises(ValueError, match="Magic bytes check failed"):
        validate_document_security(
            header_bytes=fake_exe_bytes,
            claimed_mime="application/pdf",
            file_size=1024,
            doc_type="SALE_DEED"
        )

    # Valid PDF magic bytes with spoofed claimed mime
    pdf_bytes = b"%PDF-1.4 sample content"
    with pytest.raises(ValueError, match="MIME type spoofing detected"):
        validate_document_security(
            header_bytes=pdf_bytes,
            claimed_mime="image/png", # Mismatch
            file_size=1024,
            doc_type="SALE_DEED"
        )

def test_oversized_file_rejection():
    """Verify that files exceeding the maximum size limit are strictly rejected."""
    pdf_bytes = b"%PDF-1.4"
    exceeded_size = 30 * 1024 * 1024 # 30 MB > 25 MB limit for SALE_DEED
    
    with pytest.raises(ValueError, match="exceeds maximum allowed limit"):
        validate_document_security(
            header_bytes=pdf_bytes,
            claimed_mime="application/pdf",
            file_size=exceeded_size,
            doc_type="SALE_DEED"
        )

@pytest.mark.asyncio
async def test_sql_injection_resistance(db_session):
    """Verify that malicious SQL payloads in query parameters do not compromise database."""
    transport = ASGITransport(app=app)
    malicious_inputs = [
        "' OR '1'='1",
        "'; DROP TABLE lands; --",
        "1 UNION SELECT * FROM users--",
        "admin'--",
    ]

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for payload in malicious_inputs:
            # Test in lands filter
            res = await client.get(f"/api/v1/lands?status_filter={payload}")
            # Parameterized query handles payload safely as literal string
            assert res.status_code == 200
            data = res.json()
            assert data["total"] == 0 # No lands with status == payload

@pytest.mark.asyncio
async def test_zero_pii_storage_invariant(db_session):
    """
    Verify the fundamental architectural invariant: Zero PII on-chain and in derived read-models.
    Ensures that no column or stored value contains raw 12-digit Aadhaar or national ID numbers.
    """
    # Inspect users table
    stmt = select(User)
    users = (await db_session.execute(stmt)).scalars().all()

    for u in users:
        # identity_id must be an opaque hex string or UUID
        assert u.identity_id.startswith("0x") or len(u.identity_id) == 36 or len(u.identity_id) == 66
        # No 12-digit plain Aadhaar number stored
        assert not (len(u.identity_id) == 12 and u.identity_id.isdigit())
        if u.kyc_reference:
            # Must be an opaque reference, not raw national ID
            assert "MOCK-UIDAI" in u.kyc_reference or len(u.kyc_reference) >= 16

    # Verify no User attributes exist for raw national IDs or biometrics
    user_cols = [col.name for col in User.__table__.columns]
    forbidden_terms = ["aadhaar", "national_id", "biometric", "fingerprint", "iris", "ssn"]
    for col in user_cols:
        for term in forbidden_terms:
            assert term not in col.lower(), f"Forbidden PII column '{col}' detected in User model!"

@pytest.mark.asyncio
async def test_jwt_session_expiry_and_replay_protection():
    """Verify expired JWT tokens are rejected and SIWE nonces are strictly single-use."""
    from eth_account import Account
    import jwt
    from datetime import datetime, timezone, timedelta
    from backend.app.config import settings

    wallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    
    # 1. Nonce single-use enforcement:
    nonce, _, _ = auth_service.generate_nonce(wallet)
    account = Account.create()
    test_wallet = account.address
    nonce_test, _, _ = auth_service.generate_nonce(test_wallet)

    siwe_msg = (
        f"localhost wants you to sign in with your Ethereum account:\n"
        f"{test_wallet}\n\n"
        f"Sign in with Ethereum.\n\n"
        f"URI: http://localhost:3000\n"
        f"Version: 1\n"
        f"Chain ID: 11155111\n"
        f"Nonce: {nonce_test}\n"
        f"Issued At: 2026-10-03T10:00:00Z"
    )
    sig = account.sign_message(encode_defunct(text=siwe_msg)).signature.hex()

    # First verification succeeds and consumes nonce
    recovered_wallet, validated_nonce = auth_service.verify_siwe_signature(siwe_msg, sig)
    assert recovered_wallet == test_wallet.lower()
    assert validated_nonce == nonce_test

    # Second verification with exact same message/signature MUST fail (Replay prevented)
    with pytest.raises(ValueError, match="Nonce not found or already consumed"):
        auth_service.verify_siwe_signature(siwe_msg, sig)

    # 2. Expired token verification
    now = datetime.now(timezone.utc)
    expired_payload = {
        "sub": "0x123",
        "wallet": wallet.lower(),
        "role": "CITIZEN",
        "iat": now - timedelta(hours=2),
        "exp": now - timedelta(hours=1), # Expired 1 hour ago
    }
    expired_token = jwt.encode(expired_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    with pytest.raises(ValueError, match="Token has expired"):
        auth_service.decode_access_token(expired_token)

