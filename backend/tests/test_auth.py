import pytest
from datetime import datetime, timezone
from eth_account.messages import encode_defunct

from backend.app.config import settings

@pytest.mark.asyncio
async def test_get_nonce_valid_wallet(client, test_wallet):
    response = await client.get(f"/api/v1/auth/nonce?wallet_address={test_wallet.address}")
    assert response.status_code == 200
    data = response.json()
    assert "nonce" in data
    assert "issued_at" in data
    assert "expires_at" in data

@pytest.mark.asyncio
async def test_siwe_verification_and_login_success(client, test_wallet):
    # 1. Fetch Nonce
    nonce_res = await client.get(f"/api/v1/auth/nonce?wallet_address={test_wallet.address}")
    nonce = nonce_res.json()["nonce"]

    # 2. Construct SIWE compliant message
    issued_at = datetime.now(timezone.utc).isoformat()
    siwe_message = (
        f"{settings.SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n"
        f"{test_wallet.address}\n\n"
        f"URI: http://{settings.SIWE_DOMAIN}\n"
        f"Version: 1\n"
        f"Chain ID: {settings.CHAIN_ID}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}"
    )

    # 3. Sign with test private key
    signable = encode_defunct(text=siwe_message)
    signed = test_wallet.sign_message(signable)
    signature = signed.signature.hex()

    # 4. Post to verify
    verify_res = await client.post(
        "/api/v1/auth/verify",
        json={"message": siwe_message, "signature": signature}
    )
    assert verify_res.status_code == 200
    token_data = verify_res.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"
    assert token_data["user"]["active_wallet"].lower() == test_wallet.address.lower()
    assert token_data["user"]["kyc_status"] == "VERIFIED"

@pytest.mark.asyncio
async def test_siwe_replay_attack_rejected(client, test_wallet):
    # 1. Fetch Nonce
    nonce_res = await client.get(f"/api/v1/auth/nonce?wallet_address={test_wallet.address}")
    nonce = nonce_res.json()["nonce"]

    siwe_message = (
        f"{settings.SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n"
        f"{test_wallet.address}\n\n"
        f"URI: http://{settings.SIWE_DOMAIN}\n"
        f"Version: 1\n"
        f"Chain ID: {settings.CHAIN_ID}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {datetime.now(timezone.utc).isoformat()}"
    )

    signable = encode_defunct(text=siwe_message)
    signature = test_wallet.sign_message(signable).signature.hex()

    # First verify succeeds
    res1 = await client.post("/api/v1/auth/verify", json={"message": siwe_message, "signature": signature})
    assert res1.status_code == 200

    # Second verify with the exact same nonce must fail (Replay attack prevention)
    res2 = await client.post("/api/v1/auth/verify", json={"message": siwe_message, "signature": signature})
    assert res2.status_code == 400
    assert "Replay attack prevented" in res2.json()["detail"]

@pytest.mark.asyncio
async def test_siwe_wrong_chain_id_rejected(client, test_wallet):
    nonce_res = await client.get(f"/api/v1/auth/nonce?wallet_address={test_wallet.address}")
    nonce = nonce_res.json()["nonce"]

    # Claiming Chain ID 1 (Ethereum Mainnet) instead of 11155111 (Sepolia)
    siwe_message = (
        f"{settings.SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n"
        f"{test_wallet.address}\n\n"
        f"URI: http://{settings.SIWE_DOMAIN}\n"
        f"Version: 1\n"
        f"Chain ID: 1\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {datetime.now(timezone.utc).isoformat()}"
    )

    signable = encode_defunct(text=siwe_message)
    signature = test_wallet.sign_message(signable).signature.hex()

    res = await client.post("/api/v1/auth/verify", json={"message": siwe_message, "signature": signature})
    assert res.status_code == 400
    assert "Invalid Chain ID" in res.json()["detail"]
