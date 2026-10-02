import json
import hashlib
import unicodedata
import math
from typing import Dict, Any, Tuple
from web3 import Web3

class ApplicationService:
    @staticmethod
    def normalize_string(val: str) -> str:
        """Applies Unicode NFKC normalization, whitespace trimming, and uppercase."""
        if not val:
            return ""
        normalized = unicodedata.normalize("NFKC", val.strip())
        return " ".join(normalized.split()).upper()

    @classmethod
    def build_canonical_parcel_data(
        cls,
        state: str,
        district: str,
        taluka: str,
        village: str,
        survey_number: str,
        subdivision: str = "0",
    ) -> Tuple[str, str]:
        """
        Builds the canonical parcel identifier string and keccak256 parcelKey.
        Format: STATE|DISTRICT|TALUKA|VILLAGE|SURVEY_NO|SUBDIVISION
        """
        n_state = cls.normalize_string(state)
        n_district = cls.normalize_string(district)
        n_taluka = cls.normalize_string(taluka)
        n_village = cls.normalize_string(village)
        n_survey = cls.normalize_string(survey_number)
        n_subdiv = cls.normalize_string(subdivision) if subdivision and subdivision.strip() else "0"

        canonical_identifier = f"{n_state}|{n_district}|{n_taluka}|{n_village}|{n_survey}|{n_subdiv}"
        
        # Keccak256 hash matching Solidity keccak256(bytes)
        raw_hex = Web3.keccak(text=canonical_identifier).hex()
        parcel_key = raw_hex if raw_hex.startswith("0x") else f"0x{raw_hex}"

        return canonical_identifier, parcel_key

    @staticmethod
    def calculate_polygon_area_sq_meters(coordinates: list) -> float:
        """Delegates to GeospatialService geodesic area calculation."""
        from backend.app.services.geospatial_service import geospatial_service
        return geospatial_service.calculate_geodesic_area_sq_meters(coordinates)

    @classmethod
    def normalize_geojson_and_hash(cls, geojson: Dict[str, Any]) -> Tuple[Dict[str, Any], str, float]:
        """
        Normalizes GeoJSON coordinate precision to 6 decimals, enforces CCW orientation,
        canonicalizes starting vertex, and computes deterministic SHA-256 geometryHash.
        """
        from backend.app.services.geospatial_service import geospatial_service
        norm_geojson, geom_hash, area_sq_meters, _ = geospatial_service.canonicalize_geojson_and_hash(geojson)
        return norm_geojson, geom_hash, area_sq_meters

application_service = ApplicationService()
