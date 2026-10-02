from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional

import json
from backend.app.database import get_db
from backend.app.models.models import LandApplication, LandBoundary, Jurisdiction, User
from backend.app.schemas.schemas import DraftApplicationCreate, ApplicationResponse, InspectorReviewRequest
from backend.app.services.application_service import application_service
from backend.app.services.geospatial_service import geospatial_service
from backend.app.api.dependencies import get_current_user, require_role

router = APIRouter(prefix="/applications", tags=["Land Applications"])

@router.post("/draft", response_model=ApplicationResponse, status_code=status.HTTP_201_CREATED)
async def create_draft_application(
    req: DraftApplicationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Citizen submits a draft land application off-chain.
    Normalizes cadastral identifiers, computes keccak256 parcelKey,
    calculates area, and deterministically hashes boundary geometry.
    """
    # 1. Canonical cadastral normalization
    canonical_id, parcel_key = application_service.build_canonical_parcel_data(
        state=req.state,
        district=req.district,
        taluka=req.taluka,
        village=req.village,
        survey_number=req.survey_number,
        subdivision=req.subdivision
    )

    # 2. Check for duplicate parcelKey in existing applications or lands
    stmt = select(LandApplication).where(LandApplication.parcel_key == parcel_key)
    existing_app = (await db.execute(stmt)).scalar_one_or_none()
    if existing_app:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An application already exists for parcel key {parcel_key}"
        )
    # 3. GeoJSON validation, normalization, area calculation, and geometryHash
    try:
        norm_geojson, geometry_hash, area_sq_meters, bounding_box = geospatial_service.canonicalize_geojson_and_hash(req.geojson)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 4. Check for spatial overlap against existing registered boundaries / applications
    stmt_existing = select(LandBoundary)
    all_boundaries = (await db.execute(stmt_existing)).scalars().all()
    candidate_list = [
        {
            "id": b.id,
            "on_chain_land_id": b.on_chain_land_id,
            "canonical_geojson": b.canonical_geojson,
            "parcel_key": None
        }
        for b in all_boundaries
    ]
    overlap_report = geospatial_service.evaluate_overlap_against_boundaries(norm_geojson, candidate_list)
    has_overlap = overlap_report["has_overlap"]
    overlap_notes = json.dumps(overlap_report["conflicts"]) if overlap_report["conflicts"] else None

    # 5. Create LandApplication row
    app = LandApplication(
        applicant_identity_id=current_user.identity_id,
        jurisdiction_id=req.jurisdiction_id,
        state=req.state.strip(),
        district=req.district.strip(),
        taluka=req.taluka.strip(),
        village=req.village.strip(),
        survey_number=req.survey_number.strip(),
        subdivision=req.subdivision.strip() if req.subdivision else "0",
        canonical_identifier=canonical_id,
        parcel_key=parcel_key,
        status="DRAFT",
        has_spatial_overlap=has_overlap,
        overlap_notes=overlap_notes
    )
    db.add(app)
    await db.flush()

    # 6. Create LandBoundary row with bounding box
    boundary = LandBoundary(
        application_id=app.id,
        area_sq_meters=area_sq_meters,
        canonical_geojson=norm_geojson,
        geometry_hash=geometry_hash,
        min_lon=bounding_box["min_lon"],
        min_lat=bounding_box["min_lat"],
        max_lon=bounding_box["max_lon"],
        max_lat=bounding_box["max_lat"]
    )
    db.add(boundary)
    await db.commit()
    await db.refresh(app)

    return ApplicationResponse(
        id=app.id,
        applicant_identity_id=app.applicant_identity_id,
        jurisdiction_id=app.jurisdiction_id,
        state=app.state,
        district=app.district,
        taluka=app.taluka,
        village=app.village,
        survey_number=app.survey_number,
        subdivision=app.subdivision,
        canonical_identifier=app.canonical_identifier,
        parcel_key=app.parcel_key,
        geometry_hash=geometry_hash,
        area_sq_meters=area_sq_meters,
        status=app.status,
        has_spatial_overlap=app.has_spatial_overlap,
        overlap_notes=app.overlap_notes,
        created_at=app.created_at
    )

@router.get("/{application_id}", response_model=ApplicationResponse)
async def get_application(
    application_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve full application details."""
    stmt = select(LandApplication).where(LandApplication.id == application_id)
    app = (await db.execute(stmt)).scalar_one_or_none()

    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    # Access check: owner or inspector/admin
    if app.applicant_identity_id != current_user.identity_id and current_user.role not in ["INSPECTOR", "SENIOR_INSPECTOR", "REGISTRAR", "ADMIN"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Load boundary
    stmt_b = select(LandBoundary).where(LandBoundary.application_id == app.id)
    boundary = (await db.execute(stmt_b)).scalar_one_or_none()

    return ApplicationResponse(
        id=app.id,
        applicant_identity_id=app.applicant_identity_id,
        jurisdiction_id=app.jurisdiction_id,
        state=app.state,
        district=app.district,
        taluka=app.taluka,
        village=app.village,
        survey_number=app.survey_number,
        subdivision=app.subdivision,
        canonical_identifier=app.canonical_identifier,
        parcel_key=app.parcel_key,
        geometry_hash=boundary.geometry_hash if boundary else "",
        area_sq_meters=float(boundary.area_sq_meters) if boundary else 0.0,
        status=app.status,
        has_spatial_overlap=app.has_spatial_overlap,
        overlap_notes=app.overlap_notes,
        created_at=app.created_at
    )

@router.get("", response_model=List[ApplicationResponse])
async def list_applications(
    jurisdiction_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List applications.
    Citizens view their own applications; inspectors view applications within their assigned jurisdiction.
    """
    stmt = select(LandApplication)

    if current_user.role == "CITIZEN":
        stmt = stmt.where(LandApplication.applicant_identity_id == current_user.identity_id)
    else:
        if jurisdiction_id:
            stmt = stmt.where(LandApplication.jurisdiction_id == jurisdiction_id)
        if status_filter:
            stmt = stmt.where(LandApplication.status == status_filter)

    results = (await db.execute(stmt)).scalars().all()
    output = []

    for app in results:
        stmt_b = select(LandBoundary).where(LandBoundary.application_id == app.id)
        boundary = (await db.execute(stmt_b)).scalar_one_or_none()

        output.append(
            ApplicationResponse(
                id=app.id,
                applicant_identity_id=app.applicant_identity_id,
                jurisdiction_id=app.jurisdiction_id,
                state=app.state,
                district=app.district,
                taluka=app.taluka,
                village=app.village,
                survey_number=app.survey_number,
                subdivision=app.subdivision,
                canonical_identifier=app.canonical_identifier,
                parcel_key=app.parcel_key,
                geometry_hash=boundary.geometry_hash if boundary else "",
                area_sq_meters=float(boundary.area_sq_meters) if boundary else 0.0,
                status=app.status,
                has_spatial_overlap=app.has_spatial_overlap,
                overlap_notes=app.overlap_notes,
                created_at=app.created_at
            )
        )

    return output

@router.post("/{application_id}/review", response_model=ApplicationResponse)
async def review_application(
    application_id: str,
    req: InspectorReviewRequest,
    current_user: User = Depends(require_role("INSPECTOR", "SENIOR_INSPECTOR", "REGISTRAR", "ADMIN")),
    db: AsyncSession = Depends(get_db)
):
    """
    Inspector approves or rejects an application.
    If approved, application becomes eligible for on-chain minting (`registerLand`).
    """
    stmt = select(LandApplication).where(LandApplication.id == application_id)
    app = (await db.execute(stmt)).scalar_one_or_none()

    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    if req.decision.upper() not in ["APPROVED", "REJECTED"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision must be APPROVED or REJECTED")

    app.status = req.decision.upper()
    if req.reason:
        app.overlap_notes = req.reason

    await db.commit()
    await db.refresh(app)

    stmt_b = select(LandBoundary).where(LandBoundary.application_id == app.id)
    boundary = (await db.execute(stmt_b)).scalar_one_or_none()

    return ApplicationResponse(
        id=app.id,
        applicant_identity_id=app.applicant_identity_id,
        jurisdiction_id=app.jurisdiction_id,
        state=app.state,
        district=app.district,
        taluka=app.taluka,
        village=app.village,
        survey_number=app.survey_number,
        subdivision=app.subdivision,
        canonical_identifier=app.canonical_identifier,
        parcel_key=app.parcel_key,
        geometry_hash=boundary.geometry_hash if boundary else "",
        area_sq_meters=float(boundary.area_sq_meters) if boundary else 0.0,
        status=app.status,
        has_spatial_overlap=app.has_spatial_overlap,
        overlap_notes=app.overlap_notes,
        created_at=app.created_at
    )
