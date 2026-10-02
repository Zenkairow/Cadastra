from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from typing import Optional, List, Dict, Any

from backend.app.database import get_db
from backend.app.models.models import LandBoundary, Land, LandApplication
from backend.app.schemas.schemas import (
    GeoJSONValidationRequest,
    GeoJSONValidationResponse,
    BoundingBox,
    OverlapCheckRequest,
    OverlapCheckResponse,
    ConflictDetail,
    GeometryIntegrityResponse
)
from backend.app.services.geospatial_service import geospatial_service

router = APIRouter(prefix="/geospatial", tags=["Geospatial & Maps"])

@router.post("/validate", response_model=GeoJSONValidationResponse)
async def validate_polygon(req: GeoJSONValidationRequest):
    """
    Validates GeoJSON Polygon structure, coordinate bounds, ring closure, and OGC topological validity.
    Returns canonical GeoJSON, SHA-256 geometryHash, and ellipsoidal geodesic surface area.
    """
    try:
        canonical_geojson, geom_hash, area_sqm, bbox = geospatial_service.canonicalize_geojson_and_hash(req.geojson)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GeoJSON: {str(e)}"
        )

    area_hectares = round(area_sqm / 10000.0, 4)
    area_acres = round(area_sqm / 4046.8564224, 4)

    return GeoJSONValidationResponse(
        is_valid=True,
        area_sq_meters=area_sqm,
        area_hectares=area_hectares,
        area_acres=area_acres,
        canonical_geojson=canonical_geojson,
        geometry_hash=geom_hash,
        bounding_box=BoundingBox(**bbox)
    )

@router.post("/check-overlap", response_model=OverlapCheckResponse)
async def check_overlap(
    req: OverlapCheckRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Evaluates candidate boundary against all registered land boundaries in the database.
    Performs spatial pre-filtering and exact Shapely intersection analysis.
    Distinguishes shared boundary contact (not an overlap) from encroachment and duplicate parcels.
    """
    try:
        canonical_cand, _, _, bbox = geospatial_service.canonicalize_geojson_and_hash(req.geojson)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid candidate GeoJSON: {str(e)}"
        )

    # 1. Spatial pre-filtering via Bounding Box with 0.0001 deg (~11m) buffer margin
    margin = 0.0001
    stmt = select(LandBoundary).where(
        or_(
            LandBoundary.min_lon.is_(None),  # Include legacy rows without bbox
            and_(
                LandBoundary.max_lon >= (bbox["min_lon"] - margin),
                LandBoundary.min_lon <= (bbox["max_lon"] + margin),
                LandBoundary.max_lat >= (bbox["min_lat"] - margin),
                LandBoundary.min_lat <= (bbox["max_lat"] + margin)
            )
        )
    )

    if req.exclude_application_id:
        stmt = stmt.where(LandBoundary.application_id != req.exclude_application_id)
    if req.exclude_land_id:
        stmt = stmt.where(LandBoundary.on_chain_land_id != req.exclude_land_id)

    candidates = (await db.execute(stmt)).scalars().all()

    # 2. Convert candidate boundaries into evaluation payload
    candidate_list = []
    for b in candidates:
        candidate_list.append({
            "id": b.id,
            "on_chain_land_id": b.on_chain_land_id,
            "canonical_geojson": b.canonical_geojson,
            "parcel_key": None
        })

    # 3. Execute precise geometric overlap analysis
    report = geospatial_service.evaluate_overlap_against_boundaries(canonical_cand, candidate_list)

    conflict_models = [ConflictDetail(**c) for c in report["conflicts"]]

    return OverlapCheckResponse(
        has_overlap=report["has_overlap"],
        severity=report["severity"],
        candidate_area_sqm=report["candidate_area_sqm"],
        conflict_count=report["conflict_count"],
        conflicts=conflict_models
    )

@router.get("/parcels")
async def get_parcels_feature_collection(
    min_lon: Optional[float] = Query(None, description="Bounding box minimum longitude"),
    min_lat: Optional[float] = Query(None, description="Bounding box minimum latitude"),
    max_lon: Optional[float] = Query(None, description="Bounding box maximum longitude"),
    max_lat: Optional[float] = Query(None, description="Bounding box maximum latitude"),
    jurisdiction_id: Optional[int] = Query(None, description="Filter by jurisdiction ID"),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns an RFC 7946 GeoJSON FeatureCollection of parcel boundaries for map rendering.
    Compatible with Google Maps Data Layer, Leaflet, and Mapbox GL.
    """
    stmt = select(LandBoundary).limit(limit)

    if min_lon is not None and max_lon is not None and min_lat is not None and max_lat is not None:
        stmt = stmt.where(
            or_(
                LandBoundary.min_lon.is_(None),
                and_(
                    LandBoundary.max_lon >= min_lon,
                    LandBoundary.min_lon <= max_lon,
                    LandBoundary.max_lat >= min_lat,
                    LandBoundary.min_lat <= max_lat
                )
            )
        )

    boundaries = (await db.execute(stmt)).scalars().all()

    features = []
    for b in boundaries:
        features.append({
            "type": "Feature",
            "geometry": b.canonical_geojson,
            "properties": {
                "boundary_id": b.id,
                "application_id": b.application_id,
                "on_chain_land_id": b.on_chain_land_id,
                "area_sq_meters": float(b.area_sq_meters),
                "geometry_hash": b.geometry_hash
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }

@router.post("/verify-integrity/{parcel_id}", response_model=GeometryIntegrityResponse)
async def verify_geometry_integrity(
    parcel_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Integrity verification: Recomputes the canonical geometryHash from the stored database geometry
    and compares it against the stored geometry_hash to detect any database tampering or coordinate drift.
    """
    # Try finding by on_chain_land_id or application_id or id
    stmt = select(LandBoundary).where(
        or_(
            LandBoundary.id == parcel_id,
            LandBoundary.application_id == parcel_id
        )
    )
    if parcel_id.isdigit():
        stmt = select(LandBoundary).where(
            or_(
                LandBoundary.on_chain_land_id == int(parcel_id),
                LandBoundary.id == parcel_id,
                LandBoundary.application_id == parcel_id
            )
        )

    boundary = (await db.execute(stmt)).scalar_one_or_none()
    if not boundary:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Boundary record for parcel ID '{parcel_id}' not found"
        )

    # Recompute hash from stored canonical_geojson
    try:
        _, recomputed_hash, _, _ = geospatial_service.canonicalize_geojson_and_hash(boundary.canonical_geojson)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to recompute geometry hash: {str(e)}"
        )

    is_intact = (recomputed_hash.lower() == boundary.geometry_hash.lower())

    return GeometryIntegrityResponse(
        parcel_id=parcel_id,
        stored_geometry_hash=boundary.geometry_hash,
        recomputed_geometry_hash=recomputed_hash,
        is_intact=is_intact,
        status="MATCH" if is_intact else "DRIFT_DETECTED"
    )
