import pytest
import pytest_asyncio
import json
from shapely.geometry import Polygon

from backend.app.services.geospatial_service import geospatial_service
from backend.app.models.models import LandBoundary, LandApplication, User, Jurisdiction
from backend.app.services.auth_service import auth_service

# Sample coordinates in Pune (Maharashtra)
# Parcel 1: 40m x 30m rectangle
PARCEL_1_COORDS = [
    [73.856000, 18.520000],
    [73.856379, 18.520000],
    [73.856379, 18.520270],
    [73.856000, 18.520270],
    [73.856000, 18.520000]
]

# Parcel 2 (Touching top edge of Parcel 1 - Shared Boundary)
PARCEL_2_TOUCHING_TOP = [
    [73.856000, 18.520270],
    [73.856379, 18.520270],
    [73.856379, 18.520540],
    [73.856000, 18.520540],
    [73.856000, 18.520270]
]

# Parcel 3 (Partial Overlap - 50% encroachment on Parcel 1)
PARCEL_3_PARTIAL_OVERLAP = [
    [73.856189, 18.520135],
    [73.856568, 18.520135],
    [73.856568, 18.520405],
    [73.856189, 18.520405],
    [73.856189, 18.520135]
]

# Parcel 4 (Near-Overlap - 3m buffer north of Parcel 1)
PARCEL_4_NEAR_OVERLAP = [
    [73.856000, 18.520297], # ~3 meters north of 18.520270
    [73.856379, 18.520297],
    [73.856379, 18.520567],
    [73.856000, 18.520567],
    [73.856000, 18.520297]
]

# Parcel 5 (Disjoint - 500m away)
PARCEL_5_DISJOINT = [
    [73.861000, 18.525000],
    [73.861379, 18.525000],
    [73.861379, 18.525270],
    [73.861000, 18.525270],
    [73.861000, 18.525000]
]

def test_identical_polygons_exact_overlap():
    result = geospatial_service.check_polygon_overlap(
        candidate_coords=PARCEL_1_COORDS,
        registered_coords=PARCEL_1_COORDS,
        reg_parcel_id=101
    )
    assert result["overlap_type"] == "EXACT_OVERLAP"
    assert result["is_overlap"] is True
    assert result["severity"] == "CRITICAL"
    assert result["overlap_pct_candidate"] >= 98.0
    assert result["intersection_area_sqm"] > 0

def test_partial_overlap_encroachment():
    result = geospatial_service.check_polygon_overlap(
        candidate_coords=PARCEL_3_PARTIAL_OVERLAP,
        registered_coords=PARCEL_1_COORDS,
        reg_parcel_id=101
    )
    assert result["overlap_type"] == "PARTIAL_OVERLAP"
    assert result["is_overlap"] is True
    assert result["severity"] == "WARNING"
    assert 10.0 <= result["overlap_pct_candidate"] <= 90.0
    assert result["intersection_area_sqm"] > 1.0

def test_touching_edges_shared_boundary():
    result = geospatial_service.check_polygon_overlap(
        candidate_coords=PARCEL_2_TOUCHING_TOP,
        registered_coords=PARCEL_1_COORDS,
        reg_parcel_id=101
    )
    assert result["overlap_type"] == "SHARED_BOUNDARY"
    assert result["is_overlap"] is False
    assert result["severity"] == "CLEAR"
    assert result["intersection_area_sqm"] == 0.0

def test_near_overlap_within_buffer():
    result = geospatial_service.check_polygon_overlap(
        candidate_coords=PARCEL_4_NEAR_OVERLAP,
        registered_coords=PARCEL_1_COORDS,
        reg_parcel_id=101
    )
    assert result["overlap_type"] == "NEAR_OVERLAP"
    assert result["is_overlap"] is False
    assert result["severity"] == "INFO"
    assert result["distance_meters"] <= 5.0

def test_disjoint_polygons_clear():
    result = geospatial_service.check_polygon_overlap(
        candidate_coords=PARCEL_5_DISJOINT,
        registered_coords=PARCEL_1_COORDS,
        reg_parcel_id=101
    )
    assert result["overlap_type"] == "DISJOINT"
    assert result["is_overlap"] is False
    assert result["severity"] == "CLEAR"
    assert result["distance_meters"] > 5.0

def test_invalid_geojson_rejection():
    # 1. Unclosed ring
    unclosed = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1]]]}
    valid, err = geospatial_service.validate_geojson(unclosed)
    assert not valid
    assert "at least 4 coordinate pairs" in err

    # 2. Self-intersecting bowtie polygon
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]
    }
    valid, err = geospatial_service.validate_geojson(bowtie)
    assert not valid
    assert "Self-intersecting" in err

    # 3. Out-of-bounds coordinates
    oob = {
        "type": "Polygon",
        "coordinates": [[[195.0, 0.0], [196.0, 0.0], [196.0, 1.0], [195.0, 0.0]]]
    }
    valid, err = geospatial_service.validate_geojson(oob)
    assert not valid
    assert "out of valid range" in err

def test_canonical_geometry_hash_stability():
    """
    Verifies that rotation, reversed winding (CW vs CCW), and coordinate whitespace
    produce the EXACT same geometryHash.
    """
    # Base CCW polygon
    poly_base = {"type": "Polygon", "coordinates": [PARCEL_1_COORDS]}
    _, hash_base, area_base, _ = geospatial_service.canonicalize_geojson_and_hash(poly_base)

    # 1. Rotated start vertex (start from vertex 2)
    pts = PARCEL_1_COORDS[:-1]
    rotated_pts = pts[2:] + pts[:2]
    poly_rotated = {"type": "Polygon", "coordinates": [rotated_pts + [rotated_pts[0]]]}
    _, hash_rotated, _, _ = geospatial_service.canonicalize_geojson_and_hash(poly_rotated)
    assert hash_base == hash_rotated, "Hash must be invariant to start vertex rotation"

    # 2. Reversed winding order (Clockwise)
    reversed_pts = list(reversed(pts))
    poly_cw = {"type": "Polygon", "coordinates": [reversed_pts + [reversed_pts[0]]]}
    _, hash_cw, _, _ = geospatial_service.canonicalize_geojson_and_hash(poly_cw)
    assert hash_base == hash_cw, "Hash must be invariant to CW/CCW ring orientation"

    # 3. Floating point variance within 6 decimals
    coords_micro_variance = [
        [73.8560000001, 18.5200000002],
        [73.8563790001, 18.5200000002],
        [73.8563790001, 18.5202700002],
        [73.8560000001, 18.5202700002],
        [73.8560000001, 18.5200000002]
    ]
    poly_micro = {"type": "Polygon", "coordinates": [coords_micro_variance]}
    _, hash_micro, _, _ = geospatial_service.canonicalize_geojson_and_hash(poly_micro)
    assert hash_base == hash_micro, "Hash must round coordinates to 6 decimal precision"

    # 4. Real change MUST produce a different hash
    coords_changed = list(PARCEL_1_COORDS)
    coords_changed[1] = [73.856500, 18.520000] # shifted vertex
    poly_changed = {"type": "Polygon", "coordinates": [coords_changed]}
    _, hash_changed, _, _ = geospatial_service.canonicalize_geojson_and_hash(poly_changed)
    assert hash_base != hash_changed, "Any real coordinate shift must alter geometryHash"

@pytest.mark.asyncio
async def test_api_geospatial_validate(client):
    payload = {"geojson": {"type": "Polygon", "coordinates": [PARCEL_1_COORDS]}}
    res = await client.post("/api/v1/geospatial/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["is_valid"] is True
    assert data["area_sq_meters"] > 0
    assert data["area_hectares"] > 0
    assert data["area_acres"] > 0
    assert data["geometry_hash"].startswith("0x")
    assert "bounding_box" in data

@pytest.mark.asyncio
async def test_api_geospatial_check_overlap_and_get_parcels(client, db_session):
    # Register boundary 1 in DB
    norm_geo, geom_hash, area_sqm, bbox = geospatial_service.canonicalize_geojson_and_hash(
        {"type": "Polygon", "coordinates": [PARCEL_1_COORDS]}
    )
    b1 = LandBoundary(
        area_sq_meters=area_sqm,
        canonical_geojson=norm_geo,
        geometry_hash=geom_hash,
        on_chain_land_id=5001,
        min_lon=bbox["min_lon"],
        min_lat=bbox["min_lat"],
        max_lon=bbox["max_lon"],
        max_lat=bbox["max_lat"]
    )
    db_session.add(b1)
    await db_session.commit()

    # 1. Test check-overlap with exact duplicate
    dup_payload = {
        "geojson": {"type": "Polygon", "coordinates": [PARCEL_1_COORDS]}
    }
    res_dup = await client.post("/api/v1/geospatial/check-overlap", json=dup_payload)
    assert res_dup.status_code == 200
    dup_data = res_dup.json()
    assert dup_data["has_overlap"] is True
    assert dup_data["severity"] == "CRITICAL"
    assert len(dup_data["conflicts"]) == 1
    assert dup_data["conflicts"][0]["overlap_type"] == "EXACT_OVERLAP"

    # 2. Test check-overlap with shared boundary
    touch_payload = {
        "geojson": {"type": "Polygon", "coordinates": [PARCEL_2_TOUCHING_TOP]}
    }
    res_touch = await client.post("/api/v1/geospatial/check-overlap", json=touch_payload)
    assert res_touch.status_code == 200
    touch_data = res_touch.json()
    assert touch_data["has_overlap"] is False
    assert touch_data["severity"] == "CLEAR"

    # 3. Test GET /api/v1/geospatial/parcels
    res_parcels = await client.get("/api/v1/geospatial/parcels")
    assert res_parcels.status_code == 200
    feature_collection = res_parcels.json()
    assert feature_collection["type"] == "FeatureCollection"
    assert len(feature_collection["features"]) >= 1
    matching_feats = [f for f in feature_collection["features"] if f["properties"]["geometry_hash"] == geom_hash]
    assert len(matching_feats) >= 1
    assert matching_feats[0]["geometry"]["type"] == "Polygon"

    # 4. Test verify-integrity
    res_intact = await client.post(f"/api/v1/geospatial/verify-integrity/{b1.id}")
    assert res_intact.status_code == 200
    intact_data = res_intact.json()
    assert intact_data["is_intact"] is True
    assert intact_data["status"] == "MATCH"

@pytest.mark.asyncio
async def test_application_creation_flags_spatial_overlap(client, db_session, test_wallet):
    # Setup user
    user = User(
        identity_id="0x" + "bb" * 32,
        active_wallet=test_wallet.address.lower(),
        role="CITIZEN",
        kyc_status="VERIFIED"
    )
    jurisdiction = Jurisdiction(id=201, name="Pune East", state="Maharashtra", district="Pune")
    db_session.add_all([user, jurisdiction])
    await db_session.commit()

    token = auth_service.create_access_token(user.identity_id, user.active_wallet, user.role)

    # Use distinct coordinates for Wagholi application test
    app_base_coords = [
        [73.980000, 18.580000],
        [73.980379, 18.580000],
        [73.980379, 18.580270],
        [73.980000, 18.580270],
        [73.980000, 18.580000]
    ]
    app_encroaching_coords = [
        [73.980189, 18.580135],
        [73.980568, 18.580135],
        [73.980568, 18.580405],
        [73.980189, 18.580405],
        [73.980189, 18.580135]
    ]

    # 1. Create first application (baseline)
    app1_payload = {
        "jurisdiction_id": 201,
        "state": "Maharashtra",
        "district": "Pune",
        "taluka": "Haveli",
        "village": "Wagholi",
        "survey_number": "100",
        "subdivision": "1",
        "geojson": {"type": "Polygon", "coordinates": [app_base_coords]}
    }
    headers = {"Authorization": f"Bearer {token}"}
    res1 = await client.post("/api/v1/applications/draft", json=app1_payload, headers=headers)
    assert res1.status_code == 201
    data1 = res1.json()
    assert data1["has_spatial_overlap"] is False

    # 2. Create second application encroaching on the first application
    app2_payload = {
        "jurisdiction_id": 201,
        "state": "Maharashtra",
        "district": "Pune",
        "taluka": "Haveli",
        "village": "Wagholi",
        "survey_number": "101", # different parcel_key
        "subdivision": "1",
        "geojson": {"type": "Polygon", "coordinates": [app_encroaching_coords]}
    }
    res2 = await client.post("/api/v1/applications/draft", json=app2_payload, headers=headers)
    assert res2.status_code == 201
    data2 = res2.json()
    assert data2["has_spatial_overlap"] is True
    assert data2["overlap_notes"] is not None
    assert "PARTIAL_OVERLAP" in data2["overlap_notes"]
