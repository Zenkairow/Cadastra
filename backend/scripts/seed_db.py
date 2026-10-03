import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from eth_utils import keccak
from pyunormalize import NFC, NFKC
from sqlalchemy import select

from backend.app.database import engine, Base, AsyncSessionLocal
from backend.app.models.models import (
    User, WalletBinding, Jurisdiction, Inspector,
    LandApplication, LandBoundary, Document, DocumentManifest,
    Land, Escrow, SyncState
)
from backend.app.services.geospatial_service import geospatial_service
from backend.app.services.application_service import application_service

def utc_now():
    return datetime.now(timezone.utc)

def deterministic_uuid(seed_str: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, seed_str))

async def seed():
    print("==========================================================")
    print("Seeding Cadastra Database with Master Plan Initial State")
    print("==========================================================")

    # 1. Ensure all tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # 1. Jurisdictions
        print("[1/6] Seeding Jurisdictions...")
        jurisdictions = [
            Jurisdiction(id=101, name="Pune Metropolitan Cadastral Office", state="Maharashtra", district="Pune"),
            Jurisdiction(id=102, name="Nashik Division Revenue Office", state="Maharashtra", district="Nashik"),
            Jurisdiction(id=103, name="Mumbai Suburban Land Registry", state="Maharashtra", district="Mumbai Suburban"),
            Jurisdiction(id=104, name="Nagpur Regional Registrar", state="Maharashtra", district="Nagpur"),
        ]
        for j in jurisdictions:
            await session.merge(j)

        # 2. Key Role Users & Wallets
        print("[2/6] Seeding Key Users & Identity Bindings...")
        deployer_wallet = "0x9f4e1425010C383A1818d9daBf55f0Aa2FaF6811".lower()
        admin_wallet = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".lower()
        registrar_pune = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".lower()
        senior_pune = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".lower()
        field_pune = "0x90F79bf6EB2c4f870365E785982E1f101E93b906".lower()
        alice_wallet = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65".lower()
        bob_wallet = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4df".lower()

        actors = [
            {"wallet": deployer_wallet, "role": "ADMIN", "name": "Sepolia Deployer Admin", "ref": "GOV-SEPOLIA-01"},
            {"wallet": admin_wallet, "role": "ADMIN", "name": "System Administrator", "ref": "GOV-ADMIN-00"},
            {"wallet": registrar_pune, "role": "REGISTRAR", "name": "Registrar Pune", "ref": "REV-REG-101"},
            {"wallet": senior_pune, "role": "SENIOR_INSPECTOR", "name": "Senior Inspector Pune", "ref": "INSP-SR-101"},
            {"wallet": field_pune, "role": "INSPECTOR", "name": "Field Inspector Pune", "ref": "INSP-FLD-101"},
            {"wallet": alice_wallet, "role": "CITIZEN", "name": "Alice Landowner", "ref": "MOCK-UIDAI-ALICE"},
            {"wallet": bob_wallet, "role": "CITIZEN", "name": "Bob Buyer", "ref": "MOCK-UIDAI-BOB"},
        ]

        user_map = {}
        for a in actors:
            identity_id = "0x" + keccak(text=f"CADASTRA_IDENTITY_{a['ref']}").hex()
            u_id = deterministic_uuid(f"USER_{identity_id}")
            
            stmt = select(User).where(User.identity_id == identity_id)
            existing_user = (await session.execute(stmt)).scalar_one_or_none()
            if existing_user:
                existing_user.active_wallet = a["wallet"]
                existing_user.role = a["role"]
                existing_user.kyc_status = "VERIFIED"
                existing_user.kyc_reference = a["ref"]
                user_map[a["role"]] = existing_user
            else:
                u = User(
                    id=u_id,
                    identity_id=identity_id,
                    active_wallet=a["wallet"],
                    role=a["role"],
                    kyc_status="VERIFIED",
                    kyc_reference=a["ref"]
                )
                session.add(u)
                user_map[a["role"]] = u

            wb_id = deterministic_uuid(f"WB_{identity_id}")
            stmt_wb = select(WalletBinding).where(WalletBinding.identity_id == identity_id)
            existing_wb = (await session.execute(stmt_wb)).scalar_one_or_none()
            if not existing_wb:
                wb = WalletBinding(
                    id=wb_id,
                    identity_id=identity_id,
                    wallet_address=a["wallet"],
                    status="ACTIVE"
                )
                session.add(wb)

        # 3. Inspectors
        print("[3/6] Seeding Inspector Registry State...")
        one_year_timestamp = int((datetime.now(timezone.utc) + timedelta(days=365)).timestamp())
        inspectors = [
            Inspector(address=admin_wallet, level=0, jurisdiction_id=0, is_active=True, valid_until=one_year_timestamp),
            Inspector(address=registrar_pune, level=1, jurisdiction_id=101, is_active=True, valid_until=one_year_timestamp, appointed_by=admin_wallet),
            Inspector(address=senior_pune, level=2, jurisdiction_id=101, is_active=True, valid_until=one_year_timestamp, appointed_by=registrar_pune),
            Inspector(address=field_pune, level=3, jurisdiction_id=101, is_active=True, valid_until=one_year_timestamp, appointed_by=registrar_pune),
        ]
        for insp in inspectors:
            await session.merge(insp)

        # 4. Registered Lands (Authoritative ground truth read-model)
        print("[4/6] Seeding Registered Lands & Spatial Geometries...")
        
        # Land 1: Pune Wagholi parcel (Owner: Alice)
        canon_id_1, p_key_1 = application_service.build_canonical_parcel_data(
            state="Maharashtra", district="Pune", taluka="Haveli",
            village="Wagholi", survey_number="124", subdivision="2A"
        )
        geo_1 = {
            "type": "Polygon",
            "coordinates": [[
                [73.9850, 18.5800],
                [73.9870, 18.5800],
                [73.9870, 18.5820],
                [73.9850, 18.5820],
                [73.9850, 18.5800]
            ]]
        }
        norm_geo_1, geo_hash_1, area_1, bbox_1 = geospatial_service.canonicalize_geojson_and_hash(geo_1)
        doc_manifest_hash_1 = "0x" + hashlib.sha256(b"MANIFEST_WAGHOLI_PARCEL_1").hexdigest()

        land_1 = Land(
            land_id=1,
            parcel_key=p_key_1,
            owner_identity_id=user_map["CITIZEN"].identity_id,
            jurisdiction_id=101,
            status="VERIFIED",
            geometry_hash=geo_hash_1,
            document_manifest_hash=doc_manifest_hash_1,
            registered_block=1001,
            verified_block=1005,
            verified_by_inspector=senior_pune
        )
        await session.merge(land_1)

        # LandBoundary 1
        stmt_b1 = select(LandBoundary).where(LandBoundary.on_chain_land_id == 1)
        existing_b1 = (await session.execute(stmt_b1)).scalar_one_or_none()
        if not existing_b1:
            b_1_id = deterministic_uuid("BOUNDARY_LAND_1")
            b_1 = LandBoundary(
                id=b_1_id,
                on_chain_land_id=1,
                area_sq_meters=area_1,
                canonical_geojson=norm_geo_1,
                geometry_hash=geo_hash_1,
                min_lon=bbox_1["min_lon"],
                min_lat=bbox_1["min_lat"],
                max_lon=bbox_1["max_lon"],
                max_lat=bbox_1["max_lat"]
            )
            session.add(b_1)

        # Land 2: Nashik Panchavati parcel
        canon_id_2, p_key_2 = application_service.build_canonical_parcel_data(
            state="Maharashtra", district="Nashik", taluka="Nashik",
            village="Panchavati", survey_number="88", subdivision="1B"
        )
        geo_2 = {
            "type": "Polygon",
            "coordinates": [[
                [73.7910, 20.0050],
                [73.7930, 20.0050],
                [73.7930, 20.0070],
                [73.7910, 20.0070],
                [73.7910, 20.0050]
            ]]
        }
        norm_geo_2, geo_hash_2, area_2, bbox_2 = geospatial_service.canonicalize_geojson_and_hash(geo_2)
        doc_manifest_hash_2 = "0x" + hashlib.sha256(b"MANIFEST_NASHIK_PARCEL_2").hexdigest()

        land_2 = Land(
            land_id=2,
            parcel_key=p_key_2,
            owner_identity_id=user_map["CITIZEN"].identity_id,
            jurisdiction_id=102,
            status="VERIFIED",
            geometry_hash=geo_hash_2,
            document_manifest_hash=doc_manifest_hash_2,
            registered_block=1010,
            verified_block=1012,
            verified_by_inspector=registrar_pune
        )
        await session.merge(land_2)

        # LandBoundary 2
        stmt_b2 = select(LandBoundary).where(LandBoundary.on_chain_land_id == 2)
        existing_b2 = (await session.execute(stmt_b2)).scalar_one_or_none()
        if not existing_b2:
            b_2_id = deterministic_uuid("BOUNDARY_LAND_2")
            b_2 = LandBoundary(
                id=b_2_id,
                on_chain_land_id=2,
                area_sq_meters=area_2,
                canonical_geojson=norm_geo_2,
                geometry_hash=geo_hash_2,
                min_lon=bbox_2["min_lon"],
                min_lat=bbox_2["min_lat"],
                max_lon=bbox_2["max_lon"],
                max_lat=bbox_2["max_lat"]
            )
            session.add(b_2)

        # 5. Seed Draft Applications
        print("[5/6] Seeding Pending Land Applications...")
        canon_id_3, p_key_3 = application_service.build_canonical_parcel_data(
            state="Maharashtra", district="Pune", taluka="Haveli",
            village="Kalyani Nagar", survey_number="45", subdivision="3"
        )
        geo_3 = {
            "type": "Polygon",
            "coordinates": [[
                [73.9010, 18.5450],
                [73.9030, 18.5450],
                [73.9030, 18.5470],
                [73.9010, 18.5470],
                [73.9010, 18.5450]
            ]]
        }
        norm_geo_3, geo_hash_3, area_3, bbox_3 = geospatial_service.canonicalize_geojson_and_hash(geo_3)

        stmt_app = select(LandApplication).where(LandApplication.parcel_key == p_key_3)
        existing_app = (await session.execute(stmt_app)).scalar_one_or_none()
        if not existing_app:
            app_3_id = deterministic_uuid("APP_KALYANI_NAGAR_45")
            app_3 = LandApplication(
                id=app_3_id,
                applicant_identity_id=user_map["CITIZEN"].identity_id,
                jurisdiction_id=101,
                state="Maharashtra",
                district="Pune",
                taluka="Haveli",
                village="Kalyani Nagar",
                survey_number="45",
                subdivision="3",
                canonical_identifier=canon_id_3,
                parcel_key=p_key_3,
                status="SUBMITTED",
                has_spatial_overlap=False
            )
            session.add(app_3)

        # 6. Seed Sample Escrow
        print("[6/6] Seeding Escrow Transfer Records...")
        bob_id = "0x" + keccak(text="CADASTRA_IDENTITY_MOCK-UIDAI-BOB").hex()
        stmt_escrow = select(Escrow).where(Escrow.request_id == 1)
        existing_escrow = (await session.execute(stmt_escrow)).scalar_one_or_none()
        if not existing_escrow:
            escrow_1 = Escrow(
                request_id=1,
                land_id=1,
                buyer_identity_id=bob_id,
                seller_identity_id=user_map["CITIZEN"].identity_id,
                buyer_wallet=bob_wallet,
                agreed_price=1.5, # 1.5 ETH
                deposit_amount=1.5,
                state="FUNDED",
                approval_count=0,
                has_senior_approval=False,
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
                funded_at=datetime.now(timezone.utc)
            )
            session.add(escrow_1)

        # Sync state
        sync = SyncState(
            contract_address="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0".lower(),
            contract_name="LandRegistry",
            chain_id=11155111,
            last_processed_block=1050,
            last_processed_block_hash="0x" + "a" * 64
        )
        await session.merge(sync)

        await session.commit()

    print("\n[+] Database seeded successfully!")
    print("----------------------------------------------------------")
    print(f"Admin Wallet:            {admin_wallet}")
    print(f"Regional Registrar:      {registrar_pune} (Pune 101)")
    print(f"Senior Inspector:        {senior_pune} (Pune 101)")
    print(f"Field Inspector:         {field_pune} (Pune 101)")
    print(f"Citizen Alice (Owner):   {alice_wallet}")
    print(f"Citizen Bob (Buyer):     {bob_wallet}")
    print("----------------------------------------------------------")

if __name__ == "__main__":
    asyncio.run(seed())
