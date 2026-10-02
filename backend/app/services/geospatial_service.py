import json
import hashlib
import math
from typing import Dict, Any, List, Tuple, Optional
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, shape, mapping
from shapely.ops import orient
from shapely.validation import explain_validity

class GeospatialService:
    EARTH_RADIUS = 6371008.8  # Authalic Earth radius in meters (WGS 84)
    COORDINATE_PRECISION = 6   # ~0.11m precision at equator
    MICRO_TOLERANCE_SQM = 1.0   # Tolerances below 1 sqm treated as survey micro-jitter / boundary contact
    EXACT_OVERLAP_THRESHOLD = 98.0  # Percentage of area considered full duplicate
    NEAR_OVERLAP_DISTANCE_METERS = 5.0  # Buffer distance in meters for near-overlap awareness
    METERS_PER_DEGREE_APPROX = 111139.0  # Approximate meters per degree latitude at mid-latitudes

    @classmethod
    def validate_geojson(cls, geojson_dict: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Validates GeoJSON Polygon structure, coordinate bounds, ring closure, and OGC topological validity.
        """
        if not isinstance(geojson_dict, dict):
            return False, "GeoJSON must be a dictionary object"

        # Handle Feature wrapper if provided
        if geojson_dict.get("type") == "Feature":
            geojson_dict = geojson_dict.get("geometry", {})

        geom_type = geojson_dict.get("type")
        if geom_type != "Polygon":
            return False, f"Unsupported geometry type '{geom_type}'. Only 'Polygon' is accepted."

        coords = geojson_dict.get("coordinates")
        if not coords or not isinstance(coords, list) or len(coords) == 0:
            return False, "Polygon coordinates array cannot be empty"

        exterior_ring = coords[0]
        if not isinstance(exterior_ring, list) or len(exterior_ring) < 4:
            return False, "Exterior ring must contain at least 4 coordinate pairs (minimum 3 vertices + closing vertex)"

        # Check coordinate values
        for i, pt in enumerate(exterior_ring):
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                return False, f"Coordinate at index {i} must be a [lon, lat] pair"
            lon, lat = pt[0], pt[1]
            if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
                return False, f"Coordinates at index {i} must be numeric"
            if lon < -180.0 or lon > 180.0:
                return False, f"Longitude {lon} at index {i} out of valid range [-180, 180]"
            if lat < -90.0 or lat > 90.0:
                return False, f"Latitude {lat} at index {i} out of valid range [-90, 90]"

        # Ensure ring closure for Shapely
        closed_exterior = list(exterior_ring)
        if closed_exterior[0] != closed_exterior[-1]:
            closed_exterior.append(closed_exterior[0])

        try:
            poly = Polygon(closed_exterior)
            if not poly.is_valid:
                reason = explain_validity(poly)
                return False, f"Self-intersecting or topologically invalid polygon: {reason}"
            if poly.is_empty:
                return False, "Polygon geometry is empty"
        except Exception as e:
            return False, f"Geometry parsing error: {str(e)}"

        return True, ""

    @classmethod
    def calculate_geodesic_area_sq_meters(cls, ring_coords: List[List[float]]) -> float:
        """
        Calculates ellipsoidal geodesic surface area in square meters using spherical excess formulation
        on the WGS 84 authalic sphere (radius = 6371008.8m).
        """
        if len(ring_coords) < 4:
            return 0.0

        coords = list(ring_coords)
        if coords[0] != coords[-1]:
            coords.append(coords[0])

        area = 0.0
        for i in range(len(coords) - 1):
            p1 = coords[i]
            p2 = coords[i + 1]
            lon1, lat1 = math.radians(p1[0]), math.radians(p1[1])
            lon2, lat2 = math.radians(p2[0]), math.radians(p2[1])
            area += (lon2 - lon1) * (2.0 + math.sin(lat1) + math.sin(lat2))

        area = abs(area * cls.EARTH_RADIUS * cls.EARTH_RADIUS / 2.0)
        return round(area, 2)

    @classmethod
    def canonicalize_polygon_coordinates(cls, raw_coords: List[List[float]]) -> List[List[float]]:
        """
        Normalizes coordinate precision (6 decimals), enforces counter-clockwise (CCW) exterior ring,
        and standardizes starting vertex to the lexicographically minimum vertex (min_lon, min_lat).
        Guarantees that a polygon entered CW, CCW, or starting at any vertex yields identical coordinates.
        """
        # 1. Round to 6 decimals
        rounded = [[round(float(pt[0]), cls.COORDINATE_PRECISION), round(float(pt[1]), cls.COORDINATE_PRECISION)] for pt in raw_coords]
        
        # 2. Ensure closed
        if rounded[0] != rounded[-1]:
            rounded.append(rounded[0])

        # 3. Use Shapely to enforce CCW exterior ring (RFC 7946 GeoJSON standard)
        raw_poly = Polygon(rounded)
        if not raw_poly.is_valid:
            # Attempt to fix micro-buffer if validatable
            raw_poly = Polygon(rounded)
        ccw_poly = orient(raw_poly, sign=1.0)
        ccw_coords = [[round(float(x), cls.COORDINATE_PRECISION), round(float(y), cls.COORDINATE_PRECISION)] 
                      for x, y in ccw_poly.exterior.coords]

        # 4. Remove duplicate closing vertex to find unique vertices
        unique_pts = ccw_coords[:-1]
        if not unique_pts:
            return rounded

        # 5. Find lexicographically smallest vertex (min_lon, min_lat)
        min_idx = 0
        min_val = (unique_pts[0][0], unique_pts[0][1])
        for i in range(1, len(unique_pts)):
            val = (unique_pts[i][0], unique_pts[i][1])
            if val < min_val:
                min_val = val
                min_idx = i

        # 6. Rotate array so minimum vertex is at index 0
        rotated = unique_pts[min_idx:] + unique_pts[:min_idx]

        # 7. Re-close ring
        canonical_ring = rotated + [rotated[0]]
        return canonical_ring

    @classmethod
    def canonicalize_geojson_and_hash(cls, geojson_dict: Dict[str, Any]) -> Tuple[Dict[str, Any], str, float, Dict[str, float]]:
        """
        Full pipeline:
        1. Validates GeoJSON
        2. Canonicalizes exterior and interior rings
        3. Computes bounding box
        4. Calculates geodesic surface area in square meters
        5. Produces canonical JSON string and SHA-256 geometryHash
        """
        is_valid, err = cls.validate_geojson(geojson_dict)
        if not is_valid:
            raise ValueError(err)

        if geojson_dict.get("type") == "Feature":
            geojson_dict = geojson_dict.get("geometry", {})

        coords = geojson_dict.get("coordinates", [])
        raw_exterior = coords[0]
        canonical_exterior = cls.canonicalize_polygon_coordinates(raw_exterior)

        canonical_rings = [canonical_exterior]

        # Handle holes (interior rings) if any
        if len(coords) > 1:
            canonical_holes = []
            for hole in coords[1:]:
                # Interior rings oriented clockwise per RFC 7946
                hole_rounded = [[round(float(pt[0]), cls.COORDINATE_PRECISION), round(float(pt[1]), cls.COORDINATE_PRECISION)] for pt in hole]
                if hole_rounded[0] != hole_rounded[-1]:
                    hole_rounded.append(hole_rounded[0])
                hole_poly = Polygon(hole_rounded)
                cw_hole = orient(hole_poly, sign=-1.0)
                cw_coords = [[round(float(x), cls.COORDINATE_PRECISION), round(float(y), cls.COORDINATE_PRECISION)] for x, y in cw_hole.exterior.coords][:-1]
                if cw_coords:
                    min_idx = min(range(len(cw_coords)), key=lambda i: (cw_coords[i][0], cw_coords[i][1]))
                    rot_hole = cw_coords[min_idx:] + cw_coords[:min_idx]
                    canonical_holes.append(rot_hole + [rot_hole[0]])
            # Sort holes deterministically by first vertex
            canonical_holes.sort(key=lambda h: (h[0][0], h[0][1]))
            canonical_rings.extend(canonical_holes)

        canonical_geojson = {
            "type": "Polygon",
            "coordinates": canonical_rings
        }

        # Calculate bounding box
        min_lon = min(pt[0] for pt in canonical_exterior)
        min_lat = min(pt[1] for pt in canonical_exterior)
        max_lon = max(pt[0] for pt in canonical_exterior)
        max_lat = max(pt[1] for pt in canonical_exterior)
        bounding_box = {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat
        }

        # Geodesic area: exterior area minus any holes
        total_area = cls.calculate_geodesic_area_sq_meters(canonical_exterior)
        if len(canonical_rings) > 1:
            for hole in canonical_rings[1:]:
                total_area -= cls.calculate_geodesic_area_sq_meters(hole)
        area_sq_meters = max(round(total_area, 2), 0.0)

        # Deterministic JSON serialization
        canonical_json_str = json.dumps(canonical_geojson, sort_keys=True, separators=(",", ":"))
        geometry_hash = "0x" + hashlib.sha256(canonical_json_str.encode("utf-8")).hexdigest()

        return canonical_geojson, geometry_hash, area_sq_meters, bounding_box

    @classmethod
    def check_polygon_overlap(
        cls,
        candidate_coords: List[List[float]],
        registered_coords: List[List[float]],
        reg_parcel_id: Optional[Any] = None,
        reg_parcel_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Evaluates spatial relationship between candidate and registered polygons:
        - DISJOINT: completely separate
        - NEAR_OVERLAP: within buffer threshold (<= 5 meters), no intersection
        - SHARED_BOUNDARY: touching edges or vertex contact (intersection area = 0.0) -> NOT an overlap!
        - PARTIAL_OVERLAP: encroachment with area >= 1.0 sqm -> overlap warning!
        - EXACT_OVERLAP: >= 98% overlap area -> full duplicate critical warning!
        """
        cand_poly = Polygon(candidate_coords)
        reg_poly = Polygon(registered_coords)

        cand_area = cls.calculate_geodesic_area_sq_meters(candidate_coords)
        reg_area = cls.calculate_geodesic_area_sq_meters(registered_coords)

        if not cand_poly.intersects(reg_poly):
            # Check near-overlap distance
            dist_deg = cand_poly.distance(reg_poly)
            dist_meters = dist_deg * cls.METERS_PER_DEGREE_APPROX
            if dist_meters <= cls.NEAR_OVERLAP_DISTANCE_METERS:
                return {
                    "parcel_id": reg_parcel_id,
                    "parcel_key": reg_parcel_key,
                    "overlap_type": "NEAR_OVERLAP",
                    "is_overlap": False,
                    "severity": "INFO",
                    "intersection_area_sqm": 0.0,
                    "overlap_pct_candidate": 0.0,
                    "overlap_pct_registered": 0.0,
                    "distance_meters": round(dist_meters, 2),
                    "details": f"Parcel is in close proximity ({round(dist_meters, 2)}m away) but does not encroach."
                }
            return {
                "parcel_id": reg_parcel_id,
                "parcel_key": reg_parcel_key,
                "overlap_type": "DISJOINT",
                "is_overlap": False,
                "severity": "CLEAR",
                "intersection_area_sqm": 0.0,
                "overlap_pct_candidate": 0.0,
                "overlap_pct_registered": 0.0,
                "distance_meters": round(dist_meters, 2),
                "details": "No spatial conflict or proximity overlap."
            }

        # They intersect. Analyze the intersection geometry
        intersection = cand_poly.intersection(reg_poly)

        # If intersection is 0D or 1D (Point, MultiPoint, LineString, MultiLineString)
        if intersection.geom_type in ["Point", "MultiPoint", "LineString", "MultiLineString"]:
            return {
                "parcel_id": reg_parcel_id,
                "parcel_key": reg_parcel_key,
                "overlap_type": "SHARED_BOUNDARY",
                "is_overlap": False,
                "severity": "CLEAR",
                "intersection_area_sqm": 0.0,
                "overlap_pct_candidate": 0.0,
                "overlap_pct_registered": 0.0,
                "distance_meters": 0.0,
                "details": "Adjoining parcel boundary contact (shared property line or corner). Not an overlap."
            }

        # If intersection is Polygon or MultiPolygon
        inter_coords = []
        if intersection.geom_type == "Polygon":
            inter_coords = list(intersection.exterior.coords)
            inter_area = cls.calculate_geodesic_area_sq_meters(inter_coords)
        elif intersection.geom_type == "MultiPolygon":
            inter_area = sum(cls.calculate_geodesic_area_sq_meters(list(p.exterior.coords)) for p in intersection.geoms)
        elif intersection.geom_type == "GeometryCollection":
            inter_area = sum(
                cls.calculate_geodesic_area_sq_meters(list(g.exterior.coords))
                for g in intersection.geoms if g.geom_type == "Polygon"
            )
        else:
            inter_area = 0.0

        if inter_area < cls.MICRO_TOLERANCE_SQM:
            return {
                "parcel_id": reg_parcel_id,
                "parcel_key": reg_parcel_key,
                "overlap_type": "SHARED_BOUNDARY",
                "is_overlap": False,
                "severity": "CLEAR",
                "intersection_area_sqm": round(inter_area, 2),
                "overlap_pct_candidate": 0.0,
                "overlap_pct_registered": 0.0,
                "distance_meters": 0.0,
                "details": f"Intersection area ({round(inter_area, 2)} sqm) is within micro-tolerance of shared boundary."
            }

        # Substantial 2D overlap detected
        pct_cand = round((inter_area / max(cand_area, 0.001)) * 100.0, 2)
        pct_reg = round((inter_area / max(reg_area, 0.001)) * 100.0, 2)

        if pct_cand >= cls.EXACT_OVERLAP_THRESHOLD or pct_reg >= cls.EXACT_OVERLAP_THRESHOLD:
            return {
                "parcel_id": reg_parcel_id,
                "parcel_key": reg_parcel_key,
                "overlap_type": "EXACT_OVERLAP",
                "is_overlap": True,
                "severity": "CRITICAL",
                "intersection_area_sqm": round(inter_area, 2),
                "overlap_pct_candidate": pct_cand,
                "overlap_pct_registered": pct_reg,
                "distance_meters": 0.0,
                "details": f"Critical duplicate parcel detected ({pct_cand}% candidate overlap, {round(inter_area, 2)} sqm)."
            }

        return {
            "parcel_id": reg_parcel_id,
            "parcel_key": reg_parcel_key,
            "overlap_type": "PARTIAL_OVERLAP",
            "is_overlap": True,
            "severity": "WARNING",
            "intersection_area_sqm": round(inter_area, 2),
            "overlap_pct_candidate": pct_cand,
            "overlap_pct_registered": pct_reg,
            "distance_meters": 0.0,
            "details": f"Partial boundary encroachment detected ({round(inter_area, 2)} sqm overlap, {pct_cand}% of parcel)."
        }

    @classmethod
    def evaluate_overlap_against_boundaries(
        cls,
        candidate_geojson: Dict[str, Any],
        registered_boundaries: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Compares candidate polygon against a list of candidate registered boundaries.
        Each registered boundary dictionary must contain:
        {'id': ..., 'on_chain_land_id': ..., 'canonical_geojson': ..., 'parcel_key': ...}
        """
        canonical_cand, _, cand_area, _ = cls.canonicalize_geojson_and_hash(candidate_geojson)
        cand_coords = canonical_cand["coordinates"][0]

        conflicts = []
        has_overlap = False
        highest_severity = "CLEAR"

        for b in registered_boundaries:
            reg_geojson = b.get("canonical_geojson", {})
            reg_coords = reg_geojson.get("coordinates", [[]])[0]
            if len(reg_coords) < 4:
                continue

            result = cls.check_polygon_overlap(
                candidate_coords=cand_coords,
                registered_coords=reg_coords,
                reg_parcel_id=b.get("on_chain_land_id") or b.get("id"),
                reg_parcel_key=b.get("parcel_key")
            )

            if result["overlap_type"] != "DISJOINT":
                conflicts.append(result)

            if result["is_overlap"]:
                has_overlap = True
                if result["severity"] == "CRITICAL":
                    highest_severity = "CRITICAL"
                elif highest_severity != "CRITICAL" and result["severity"] == "WARNING":
                    highest_severity = "WARNING"
            elif result["severity"] == "INFO" and highest_severity == "CLEAR":
                highest_severity = "INFO"

        return {
            "has_overlap": has_overlap,
            "severity": highest_severity,
            "candidate_area_sqm": cand_area,
            "conflict_count": len(conflicts),
            "conflicts": conflicts
        }

geospatial_service = GeospatialService()
