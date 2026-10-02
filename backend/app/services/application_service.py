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
        """
        Calculates ellipsoidal geodesic surface area in square meters for a lat/lng polygon.
        Uses spherical excess formulation (WGS 84 radius = 6371000m).
        """
        if len(coordinates) < 4:
            raise ValueError("Polygon must have at least 4 coordinates (closed ring)")

        # Verify ring closure
        if coordinates[0] != coordinates[-1]:
            coordinates.append(coordinates[0])

        earth_radius = 6371008.8 # meters
        area = 0.0

        for i in range(len(coordinates) - 1):
            p1 = coordinates[i]
            p2 = coordinates[i + 1]
            
            lon1, lat1 = math.radians(p1[0]), math.radians(p1[1])
            lon2, lat2 = math.radians(p2[0]), math.radians(p2[1])

            area += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))

        area = abs(area * earth_radius * earth_radius / 2.0)
        return round(area, 2)

    @classmethod
    def normalize_geojson_and_hash(cls, geojson: Dict[str, Any]) -> Tuple[Dict[str, Any], str, float]:
        """
        Normalizes GeoJSON coordinate precision to 6 decimals, calculates area,
        and computes deterministic SHA-256 geometryHash.
        """
        if geojson.get("type") != "Polygon":
            raise ValueError("Only GeoJSON Polygon geometry is supported")

        raw_coords = geojson.get("coordinates", [[]])[0]
        if len(raw_coords) < 4:
            raise ValueError("Polygon must have at least 4 points (closed ring)")

        # Round coordinates to 6 decimals (~0.1m precision)
        rounded_coords = [[round(float(pt[0]), 6), round(float(pt[1]), 6)] for pt in raw_coords]
        
        # Ensure closed ring
        if rounded_coords[0] != rounded_coords[-1]:
            rounded_coords.append(rounded_coords[0])

        normalized_geojson = {
            "type": "Polygon",
            "coordinates": [rounded_coords]
        }

        # Area calculation in square meters
        area_sq_meters = cls.calculate_polygon_area_sq_meters(rounded_coords)

        # Deterministic JSON serialization
        canonical_json_str = json.dumps(normalized_geojson, sort_keys=True, separators=(",", ":"))
        geometry_hash = "0x" + hashlib.sha256(canonical_json_str.encode("utf-8")).hexdigest()

        return normalized_geojson, geometry_hash, area_sq_meters

application_service = ApplicationService()
