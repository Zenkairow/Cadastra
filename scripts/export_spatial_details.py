"""
Export detailed spatial benchmark results and conduct GIS tolerance sensitivity analysis.
"""
import sys
import os
import json
import csv
import math
from pathlib import Path

# Add project root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.generate_synthetic_parcels import generate_dataset_a, inject_test_cases
from backend.app.services.geospatial_service import geospatial_service, GeospatialService
from shapely.geometry import shape

def main():
    root = Path(__file__).parent.parent
    spatial_dir = root / "research_validation" / "spatial"
    datasets_dir = spatial_dir / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)

    print("[*] Generating 1,000 baseline parcels for detailed CSV export...")
    dataset_a = generate_dataset_a(1000)
    test_cases = inject_test_cases(dataset_a)

    # Save dataset A
    dataset_file = datasets_dir / "dataset_a_1000.json"
    with open(dataset_file, "w") as f:
        json.dump(dataset_a, f)
    print(f"[+] Saved baseline dataset to {dataset_file}")

    # Evaluate each test case and separate into CSVs
    margin = 0.0001
    exact_rows = []
    partial_rows = []
    near_rows = []
    shared_rows = []

    for tc in test_cases:
        expected = tc["expected_type"]
        cand_geojson, _, _, cand_bbox = geospatial_service.canonicalize_geojson_and_hash(tc["candidate_geojson"])
        
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
        conflicts = report["conflicts"]

        if expected == "EXACT_OVERLAP":
            is_detected = any(c["overlap_type"] == "EXACT_OVERLAP" for c in conflicts)
            exact_rows.append([
                tc["case_id"], tc["target_parcel_id"], "EXACT_OVERLAP",
                "DETECTED" if is_detected else "MISSED",
                report["has_overlap"], len(conflicts), "PASS" if is_detected else "FAIL"
            ])
        elif expected == "PARTIAL_OVERLAP":
            is_detected = any(c["overlap_type"] == "PARTIAL_OVERLAP" for c in conflicts)
            overlap_pct = conflicts[0]["overlap_pct_candidate"] if conflicts else 0.0
            overlap_sqm = conflicts[0]["intersection_area_sqm"] if conflicts else 0.0
            partial_rows.append([
                tc["case_id"], tc["target_parcel_id"], "PARTIAL_OVERLAP",
                f"{overlap_pct:.2f}%", f"{overlap_sqm:.2f}",
                "DETECTED" if is_detected else "MISSED",
                report["has_overlap"], "PASS" if is_detected else "FAIL"
            ])
        elif expected == "NEAR_OVERLAP":
            is_detected = any(c["overlap_type"] == "NEAR_OVERLAP" for c in conflicts)
            distance_m = conflicts[0]["distance_meters"] if conflicts else 0.0
            near_rows.append([
                tc["case_id"], tc["target_parcel_id"], "NEAR_OVERLAP",
                f"{distance_m:.2f} m", "FLAG_FOR_REVIEW",
                "FLAGGED" if is_detected else "MISSED",
                report["has_overlap"], "PASS" if is_detected else "FAIL"
            ])
        elif expected == "SHARED_BOUNDARY":
            has_overlap = report["has_overlap"]
            is_correct = not has_overlap
            shared_rows.append([
                tc["case_id"], tc["target_parcel_id"], "SHARED_BOUNDARY",
                "ACCEPT (NO OVERLAP)",
                "ACCEPT" if is_correct else "REJECT",
                "FALSE_POSITIVE" if has_overlap else "TRUE_NEGATIVE",
                "PASS" if is_correct else "FAIL"
            ])

    # Write exact_duplicates.csv
    with open(spatial_dir / "exact_duplicates.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Case_ID", "Target_Parcel", "Expected_Type", "Detection_Status", "Has_Overlap", "Conflict_Count", "Outcome"])
        writer.writerows(exact_rows)

    # Write partial_overlaps.csv
    with open(spatial_dir / "partial_overlaps.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Case_ID", "Target_Parcel", "Expected_Type", "Overlap_Percentage", "Overlap_Area_Sqm", "Detection_Status", "Has_Overlap", "Outcome"])
        writer.writerows(partial_rows)

    # Write near_overlaps.csv
    with open(spatial_dir / "near_overlaps.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Case_ID", "Target_Parcel", "Expected_Type", "Distance", "Expected_Action", "Actual_Action", "Has_Overlap", "Outcome"])
        writer.writerows(near_rows)

    # Write shared_boundaries.csv
    with open(spatial_dir / "shared_boundaries.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Case_ID", "Target_Parcel", "Expected_Type", "Expected_Decision", "Actual_Decision", "Classification", "Outcome"])
        writer.writerows(shared_rows)

    print("[+] Wrote exact_duplicates.csv, partial_overlaps.csv, near_overlaps.csv, shared_boundaries.csv.")

    # --- SENSITIVITY ANALYSIS FOR GIS TOLERANCE ---
    print("\n[*] Conducting GIS Tolerance Sensitivity Experiment...")
    # The paper claims a 5 cm (0.05m) geodetic buffer tolerance.
    # We test tolerances: 0.01m, 0.05m, 0.11m (current 6 decimals), 0.50m, 1.00m (current MICRO_TOLERANCE_SQM)
    # We measure behavior on:
    # 1. 25 Shared Boundaries (False Positives if tolerance causes overlap)
    # 2. 50 Partial Overlaps (Detection Rate / False Negatives if tolerance ignores small encroachment)
    # 3. Floating-point geodetic jitter (e.g. 2 cm, 5 cm, 10 cm coordinate noise)

    tolerance_values = [
        {"name": "1 cm (0.01m)", "sqm_thresh": 0.0001, "notes": "Extreme precision; vulnerable to floating-point and GPS jitter"},
        {"name": "5 cm (0.05m)", "sqm_thresh": 0.0025, "notes": "Paper Claimed Value; physically absent in code, unsupported by GPS"},
        {"name": "11 cm (0.11m)", "sqm_thresh": 0.0121, "notes": "Equivalent to 6-decimal geodetic precision (0.000001 deg)"},
        {"name": "50 cm (0.50m)", "sqm_thresh": 0.25, "notes": "Survey-grade DGPS threshold"},
        {"name": "1.0 m (1.00 sqm)", "sqm_thresh": 1.0, "notes": "Actual Implementation Code Constant (MICRO_TOLERANCE_SQM)"}
    ]

    sensitivity_rows = []
    for tol in tolerance_values:
        sqm_thresh = tol["sqm_thresh"]
        
        # Test shared boundary false alarms with this threshold
        shared_fp = 0
        for tc in [t for t in test_cases if t["expected_type"] == "SHARED_BOUNDARY"]:
            cand_geom = shape(tc["candidate_geojson"])
            target = next(p for p in dataset_a if p["id"] == tc["target_parcel_id"])
            tgt_geom = shape(target["canonical_geojson"])
            
            # If intersection area exceeds threshold, it's flagged as overlap (FP)
            inter = cand_geom.intersection(tgt_geom)
            # convert deg^2 to approx m^2 (lat 18.52 deg)
            inter_sqm = inter.area * (111139.0 * 111139.0 * math.cos(math.radians(18.5204)))
            if inter_sqm > sqm_thresh:
                shared_fp += 1

        # Test partial overlap detection with this threshold
        partial_detected = 0
        for tc in [t for t in test_cases if t["expected_type"] == "PARTIAL_OVERLAP"]:
            cand_geom = shape(tc["candidate_geojson"])
            target = next(p for p in dataset_a if p["id"] == tc["target_parcel_id"])
            tgt_geom = shape(target["canonical_geojson"])
            inter = cand_geom.intersection(tgt_geom)
            inter_sqm = inter.area * (111139.0 * 111139.0 * math.cos(math.radians(18.5204)))
            if inter_sqm > sqm_thresh:
                partial_detected += 1

        shared_fp_rate = (shared_fp / 25.0) * 100.0
        partial_det_rate = (partial_detected / 50.0) * 100.0

        scientific_verdict = (
            "NOT SCIENTIFICALLY JUSTIFIED BY CURRENT EVIDENCE (ABSENT FROM CODE)"
            if "5 cm" in tol["name"] else
            "CODE IMPLEMENTED VALUE (MICRO_TOLERANCE_SQM = 1.0)"
            if "1.0 m" in tol["name"] else "EXPERIMENTAL EXPLORATION"
        )

        sensitivity_rows.append([
            tol["name"], tol["sqm_thresh"], f"{shared_fp}/25 ({shared_fp_rate:.1f}%)",
            f"{partial_detected}/50 ({partial_det_rate:.1f}%)",
            scientific_verdict, tol["notes"]
        ])

    with open(spatial_dir / "tolerance_sensitivity.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Tolerance_Setting", "Threshold_Sqm", "Shared_Boundary_FP_Rate", "Partial_Overlap_Detection_Rate", "Scientific_Justification_Status", "Notes"])
        writer.writerows(sensitivity_rows)

    print("[+] Wrote tolerance_sensitivity.csv with 5 distinct tolerance settings.")

if __name__ == "__main__":
    main()
