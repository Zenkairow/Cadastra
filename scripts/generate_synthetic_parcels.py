"""
Synthetic Cadastral Dataset Generator & Benchmark (Research Question RQ2)
Reference: Master Plan Section 16.4 & Phase 7 Work Packages

Generates Dataset A with 1,000 unique parcels.
Injects:
- 100 Exact Duplicates (including vertex shift & winding reversal)
- 50 Partial Overlaps (boundary encroachments >= 1 sqm)
- 25 Near-Overlaps (within 1-5m proximity buffer)
- 25 Shared Boundaries (touching edges, zero overlap area)

Evaluates:
- Detection count & accuracy (Precision, Recall)
- False positives on shared boundaries (Must be 0)
- Processing throughput (evaluations per second)
"""

import sys
import os
import json
import time
import math
import random
import argparse
from typing import List, Dict, Any, Tuple

# Add root directory to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.services.geospatial_service import geospatial_service

def meters_to_lat_deg(meters: float) -> float:
    return meters / 111139.0

def meters_to_lon_deg(meters: float, lat: float) -> float:
    return meters / (111139.0 * math.cos(math.radians(lat)))

def generate_base_parcel(center_lon: float, center_lat: float, width_m: float, height_m: float) -> List[List[float]]:
    half_w = meters_to_lon_deg(width_m / 2.0, center_lat)
    half_h = meters_to_lat_deg(height_m / 2.0)
    
    # Counter-Clockwise polygon
    p1 = [round(center_lon - half_w, 6), round(center_lat - half_h, 6)]
    p2 = [round(center_lon + half_w, 6), round(center_lat - half_h, 6)]
    p3 = [round(center_lon + half_w, 6), round(center_lat + half_h, 6)]
    p4 = [round(center_lon - half_w, 6), round(center_lat + half_h, 6)]
    p5 = list(p1)
    return [p1, p2, p3, p4, p5]

def generate_dataset_a(count: int = 1000, start_lon: float = 73.8567, start_lat: float = 18.5204) -> List[Dict[str, Any]]:
    """Generates 1,000 non-overlapping parcels arranged in a grid with 10m spacing."""
    parcels = []
    cols = int(math.ceil(math.sqrt(count)))
    parcel_w_m = 40.0
    parcel_h_m = 30.0
    gap_m = 10.0 # 10m buffer between parcels to ensure disjoint base set

    step_x_m = parcel_w_m + gap_m
    step_y_m = parcel_h_m + gap_m

    for i in range(count):
        row = i // cols
        col = i % cols

        offset_x_m = col * step_x_m
        offset_y_m = row * step_y_m

        center_lat = start_lat + meters_to_lat_deg(offset_y_m)
        center_lon = start_lon + meters_to_lon_deg(offset_x_m, center_lat)

        coords = generate_base_parcel(center_lon, center_lat, parcel_w_m, parcel_h_m)
        geojson = {
            "type": "Polygon",
            "coordinates": [coords]
        }
        canonical_geojson, geom_hash, area_sqm, bbox = geospatial_service.canonicalize_geojson_and_hash(geojson)

        parcels.append({
            "id": f"PARCEL-{i+1:04d}",
            "on_chain_land_id": i + 1,
            "parcel_key": f"0x{i+1:064x}",
            "canonical_geojson": canonical_geojson,
            "geometry_hash": geom_hash,
            "area_sq_meters": area_sqm,
            "bounding_box": bbox
        })

    return parcels

def inject_test_cases(dataset_a: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Creates test candidate cases:
    - 100 Exact Duplicates (identical, reversed winding, vertex-rotated)
    - 50 Partial Overlaps (boundary encroachments)
    - 25 Near-Overlaps (1-5m proximity buffer, zero overlap)
    - 25 Shared Boundaries (touching edges, zero overlap area)
    """
    test_cases = []

    # 1. 100 Exact Duplicates
    for i in range(100):
        target = dataset_a[i]
        coords = target["canonical_geojson"]["coordinates"][0]
        pts = coords[:-1] # unique vertices

        variant = i % 3
        if variant == 0:
            # Exact identical
            cand_coords = list(coords)
        elif variant == 1:
            # Reversed winding (Clockwise)
            cand_coords = list(reversed(pts)) + [pts[-1]]
        else:
            # Rotated start vertex
            rot_idx = (i % (len(pts) - 1)) + 1
            cand_pts = pts[rot_idx:] + pts[:rot_idx]
            cand_coords = cand_pts + [cand_pts[0]]

        cand_geojson = {"type": "Polygon", "coordinates": [cand_coords]}
        test_cases.append({
            "case_id": f"DUP-{i+1:03d}",
            "expected_type": "EXACT_OVERLAP",
            "expected_is_overlap": True,
            "target_parcel_id": target["id"],
            "candidate_geojson": cand_geojson
        })

    # 2. 50 Partial Overlaps (shift by 15 meters)
    for i in range(50):
        target = dataset_a[100 + i]
        orig_coords = target["canonical_geojson"]["coordinates"][0]
        lat_shift = meters_to_lat_deg(15.0)
        lon_shift = meters_to_lon_deg(15.0, orig_coords[0][1])

        shifted_coords = [
            [round(pt[0] + lon_shift, 6), round(pt[1] + lat_shift, 6)]
            for pt in orig_coords
        ]
        cand_geojson = {"type": "Polygon", "coordinates": [shifted_coords]}
        test_cases.append({
            "case_id": f"PARTIAL-{i+1:03d}",
            "expected_type": "PARTIAL_OVERLAP",
            "expected_is_overlap": True,
            "target_parcel_id": target["id"],
            "candidate_geojson": cand_geojson
        })

    # 3. 25 Near-Overlaps (shift to 3m distance above top-row perimeter parcels)
    # Using top row of grid (e.g., indices from count - 55 to count - 30) so there is no row above
    for i in range(25):
        target = dataset_a[-(55 - i)]
        bbox = target["bounding_box"]
        # Position parcel 3 meters above target max_lat outside the grid
        gap_lat = meters_to_lat_deg(3.0)
        center_lat = bbox["max_lat"] + gap_lat + meters_to_lat_deg(15.0)
        center_lon = (bbox["min_lon"] + bbox["max_lon"]) / 2.0

        coords = generate_base_parcel(center_lon, center_lat, 40.0, 30.0)
        cand_geojson = {"type": "Polygon", "coordinates": [coords]}
        test_cases.append({
            "case_id": f"NEAR-{i+1:03d}",
            "expected_type": "NEAR_OVERLAP",
            "expected_is_overlap": False,
            "target_parcel_id": target["id"],
            "candidate_geojson": cand_geojson
        })

    # 4. 25 Shared Boundaries (touching exactly along top edge of top-row perimeter parcels)
    # Using the last 25 parcels (top-most row of grid) so candidate extends outside the grid
    for i in range(25):
        target = dataset_a[-(25 - i)]
        bbox = target["bounding_box"]
        # Top edge shared exactly: candidate bottom = target top
        center_lat = bbox["max_lat"] + meters_to_lat_deg(15.0) # height is 30m, so half_h is 15m
        center_lon = (bbox["min_lon"] + bbox["max_lon"]) / 2.0

        coords = generate_base_parcel(center_lon, center_lat, 40.0, 30.0)
        cand_geojson = {"type": "Polygon", "coordinates": [coords]}
        test_cases.append({
            "case_id": f"SHARED-{i+1:03d}",
            "expected_type": "SHARED_BOUNDARY",
            "expected_is_overlap": False,
            "target_parcel_id": target["id"],
            "candidate_geojson": cand_geojson
        })

    return test_cases

def run_benchmark(dataset_a: List[Dict[str, Any]], test_cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    print(f"[*] Running benchmark on {len(test_cases)} injected test cases against {len(dataset_a)} registered parcels...")

    start_time = time.perf_counter()
    results = {
        "EXACT_OVERLAP": {"total": 0, "detected": 0},
        "PARTIAL_OVERLAP": {"total": 0, "detected": 0},
        "NEAR_OVERLAP": {"total": 0, "detected": 0},
        "SHARED_BOUNDARY": {"total": 0, "detected_correctly": 0, "false_positives": 0},
    }

    # Bounding-box spatial pre-filtering margin (0.0001 deg ~ 11m)
    margin = 0.0001

    for tc in test_cases:
        expected = tc["expected_type"]
        cand_geojson, _, _, cand_bbox = geospatial_service.canonicalize_geojson_and_hash(tc["candidate_geojson"])
        
        # Spatial pre-filtering step (mimicking PostGIS GIST / BBox query)
        filtered_registered = [
            p for p in dataset_a
            if not (
                p["bounding_box"]["max_lon"] < (cand_bbox["min_lon"] - margin) or
                p["bounding_box"]["min_lon"] > (cand_bbox["max_lon"] + margin) or
                p["bounding_box"]["max_lat"] < (cand_bbox["min_lat"] - margin) or
                p["bounding_box"]["min_lat"] > (cand_bbox["max_lat"] + margin)
            )
        ]

        report = geospatial_service.evaluate_overlap_against_boundaries(cand_geojson, filtered_registered)

        results[expected]["total"] += 1

        # Check classification against target
        matching_conflicts = [c for c in report["conflicts"] if c["overlap_type"] == expected]
        if expected == "EXACT_OVERLAP" and len(matching_conflicts) > 0:
            results["EXACT_OVERLAP"]["detected"] += 1
        elif expected == "PARTIAL_OVERLAP" and len(matching_conflicts) > 0:
            results["PARTIAL_OVERLAP"]["detected"] += 1
        elif expected == "NEAR_OVERLAP" and any(c["overlap_type"] == "NEAR_OVERLAP" for c in report["conflicts"]):
            results["NEAR_OVERLAP"]["detected"] += 1
        elif expected == "SHARED_BOUNDARY":
            if not report["has_overlap"]:
                results["SHARED_BOUNDARY"]["detected_correctly"] += 1
            else:
                results["SHARED_BOUNDARY"]["false_positives"] += 1

    elapsed = time.perf_counter() - start_time
    throughput = len(test_cases) / elapsed

    summary = {
        "dataset_a_parcel_count": len(dataset_a),
        "total_test_cases": len(test_cases),
        "elapsed_seconds": round(elapsed, 4),
        "throughput_cases_per_sec": round(throughput, 2),
        "exact_duplicate_detection_rate_pct": round((results["EXACT_OVERLAP"]["detected"] / results["EXACT_OVERLAP"]["total"]) * 100.0, 2),
        "partial_overlap_detection_rate_pct": round((results["PARTIAL_OVERLAP"]["detected"] / results["PARTIAL_OVERLAP"]["total"]) * 100.0, 2),
        "near_overlap_detection_rate_pct": round((results["NEAR_OVERLAP"]["detected"] / results["NEAR_OVERLAP"]["total"]) * 100.0, 2),
        "shared_boundary_false_positive_rate_pct": round((results["SHARED_BOUNDARY"]["false_positives"] / results["SHARED_BOUNDARY"]["total"]) * 100.0, 2),
        "raw_results": results
    }
    return summary

def main():
    parser = argparse.ArgumentParser(description="Synthetic Cadastral Dataset Generator & Overlap Benchmark")
    parser.add_argument("--count", type=int, default=1000, help="Number of baseline unique parcels (default 1000)")
    parser.add_argument("--benchmark", action="store_true", help="Run duplicate detection benchmark")
    parser.add_argument("--output", type=str, default="", help="Path to save generated dataset or benchmark report")
    args = parser.parse_args()

    print(f"[*] Generating Dataset A with {args.count} unique cadastral parcels...")
    dataset_a = generate_dataset_a(args.count)
    print(f"[+] Successfully generated {len(dataset_a)} parcels.")

    test_cases = inject_test_cases(dataset_a)
    print(f"[+] Injected {len(test_cases)} test cases (100 exact, 50 partial, 25 near, 25 shared boundary).")

    if args.benchmark:
        report = run_benchmark(dataset_a, test_cases)
        print("\n" + "=" * 60)
        print("           RESEARCH EXPERIMENT RQ2 BENCHMARK REPORT")
        print("=" * 60)
        print(f" Dataset A Parcels:              {report['dataset_a_parcel_count']}")
        print(f" Total Injected Test Cases:      {report['total_test_cases']}")
        print(f" Total Evaluation Time:          {report['elapsed_seconds']} s")
        print(f" Throughput:                     {report['throughput_cases_per_sec']} evaluations/sec")
        print(f" Exact Duplicate Detection Rate: {report['exact_duplicate_detection_rate_pct']}% (Target: 100%)")
        print(f" Partial Overlap Detection Rate: {report['partial_overlap_detection_rate_pct']}% (Target: 100%)")
        print(f" Near-Overlap Detection Rate:    {report['near_overlap_detection_rate_pct']}% (Target: 100%)")
        print(f" Shared Boundary False Positive: {report['shared_boundary_false_positive_rate_pct']}% (Target: 0.0%)")
        print("=" * 60)

        if args.output:
            with open(args.output, "w") as f:
                json.dump(report, f, indent=2)
            print(f"[+] Benchmark report saved to {args.output}")
    elif args.output:
        with open(args.output, "w") as f:
            json.dump({"dataset_a": dataset_a, "test_cases": test_cases}, f, indent=2)
        print(f"[+] Dataset saved to {args.output}")

if __name__ == "__main__":
    main()
