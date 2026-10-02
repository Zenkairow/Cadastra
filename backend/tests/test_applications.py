import pytest
from datetime import datetime, timezone
from eth_account.messages import encode_defunct

from backend.app.config import settings

async def authenticate_user(client, wallet):
    """Helper to log in a test wallet and obtain a JWT bearer token."""
    nonce_res = await client.get(f"/api/v1/auth/nonce?wallet_address={wallet.address}")
    nonce = nonce_res.json()["nonce"]

    siwe_message = (
        f"{settings.SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n"
        f"{wallet.address}\n\n"
        f"URI: http://{settings.SIWE_DOMAIN}\n"
        f"Version: 1\n"
        f"Chain ID: {settings.CHAIN_ID}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {datetime.now(timezone.utc).isoformat()}"
    )

    signable = encode_defunct(text=siwe_message)
    signature = wallet.sign_message(signable).signature.hex()

    verify_res = await client.post("/api/v1/auth/verify", json={"message": siwe_message, "signature": signature})
    return verify_res.json()["access_token"]

@pytest.mark.asyncio
async def test_create_draft_application_success(client, test_wallet):
    token = await authenticate_user(client, test_wallet)
    headers = {"Authorization": f"Bearer {token}"}

    sample_geojson = {
        "type": "Polygon",
        "coordinates": [
            [
                [73.856700, 18.520100],
                [73.858000, 18.521000],
                [73.859100, 18.519800],
                [73.857400, 18.518900],
                [73.856700, 18.520100]
            ]
        ]
    }

    payload = {
        "jurisdiction_id": 101,
        "state": "Maharashtra",
        "district": "Pune",
        "taluka": "Haveli",
        "village": "Kothrud",
        "survey_number": "500",
        "subdivision": "1",
        "geojson": sample_geojson
    }

    res = await client.post("/api/v1/applications/draft", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["canonical_identifier"] == "MAHARASHTRA|PUNE|HAVELI|KOTHRUD|500|1"
    assert data["parcel_key"].startswith("0x")
    assert data["geometry_hash"].startswith("0x")
    assert data["area_sq_meters"] > 0
    assert data["status"] == "DRAFT"

@pytest.mark.asyncio
async def test_duplicate_application_parcel_key_rejected(client, test_wallet):
    token = await authenticate_user(client, test_wallet)
    headers = {"Authorization": f"Bearer {token}"}

    sample_geojson = {
        "type": "Polygon",
        "coordinates": [
            [
                [73.856700, 18.520100],
                [73.858000, 18.521000],
                [73.859100, 18.519800],
                [73.857400, 18.518900],
                [73.856700, 18.520100]
            ]
        ]
    }

    payload = {
        "jurisdiction_id": 101,
        "state": "Maharashtra",
        "district": "Pune",
        "taluka": "Haveli",
        "village": "Kothrud",
        "survey_number": "501",
        "subdivision": "0",
        "geojson": sample_geojson
    }

    # First draft succeeds
    res1 = await client.post("/api/v1/applications/draft", json=payload, headers=headers)
    assert res1.status_code == 201

    # Second draft with same parcel identifier must fail with 409 Conflict
    res2 = await client.post("/api/v1/applications/draft", json=payload, headers=headers)
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"]

def test_shared_parcel_key_vectors():
    """
    Verifies that ApplicationService satisfies the shared parcel key test vectors
    from deployments/test_vectors/parcel_keys.json exactly.
    """
    import json
    import os
    from backend.app.services.application_service import application_service

    vector_path = os.path.join("deployments", "test_vectors", "parcel_keys.json")
    with open(vector_path, "r", encoding="utf-8") as f:
        vectors = json.load(f)

    for vec in vectors:
        raw = vec["input"]
        canonical_id, parcel_key = application_service.build_canonical_parcel_data(
            state=raw["state"],
            district=raw["district"],
            taluka=raw["taluka"],
            village=raw["village"],
            survey_number=raw["survey_number"],
            subdivision=raw["subdivision"]
        )
        assert canonical_id == vec["expected_canonical_identifier"], f"Failed canonical string for: {vec['description']}"
        assert parcel_key == vec["expected_parcel_key"], f"Failed parcel_key for: {vec['description']}"

