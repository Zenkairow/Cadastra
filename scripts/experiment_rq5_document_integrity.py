import hashlib
import json
import csv
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def run_document_integrity_experiment():
    print("================================================================================")
    print(" RQ5 EXPERIMENT: DOCUMENT INTEGRITY & CRYPTOGRAPHIC TAMPER DETECTION")
    print(" Evaluating 100 Documents across 4 Corruption Profiles (400 Attack Instances)")
    print("================================================================================\n")

    DOC_COUNT = 100
    base_documents = []

    print(f"--> Generating {DOC_COUNT} synthetic legal documents (PDF format with magic bytes)...")
    for i in range(DOC_COUNT):
        # Generate valid mock PDF content
        content = (
            f"%PDF-1.4\n"
            f"1 0 obj << /Title (Cadastral Deed Parcel #{1000 + i}) /Author (Govt Land Registry) >> endobj\n"
            f"2 0 obj << /Type /Catalog /Pages 3 0 R >> endobj\n"
            f"3 0 obj << /Type /Pages /Count 1 /Kids [4 0 R] >> endobj\n"
            f"4 0 obj << /Type /Page /Parent 3 0 R /Contents 5 0 R >> endobj\n"
            f"5 0 obj << /Length 64 >> stream\n"
            f"BT /F1 12 Tf 72 712 Td (Legal Conveyance Deed Survey 42 Subdiv {i}) Tj ET\n"
            f"endstream endobj\n"
            f"xref 0 6 0000000000 65535 f 0000000010 00000 n\n"
            f"trailer << /Size 6 /Root 2 0 R >>\n"
            f"startxref 420\n%%EOF"
        ).encode("utf-8")

        base_documents.append({
            "docId": i + 1,
            "rawBytes": content,
            "expectedHash": sha256_hex(content),
            "sizeBytes": len(content)
        })

    profiles = [
        {
            "id": "PROFILE_A",
            "name": "1-Byte Flip (Single Character Corruption)",
            "description": "Flipping exactly 1 bit/byte inside the document content"
        },
        {
            "id": "PROFILE_B",
            "name": "Page Truncation (Missing Tail / Partial File)",
            "description": "Truncating the trailing 15% of bytes simulating missing page"
        },
        {
            "id": "PROFILE_C",
            "name": "Metadata Modification",
            "description": "Altering document creation date / author metadata only"
        },
        {
            "id": "PROFILE_D",
            "name": "File Replacement (Complete Substitution)",
            "description": "Replacing genuine document with a forged substitute payload"
        }
    ]

    results = []

    for prof in profiles:
        print(f"--> Testing {prof['name']} across {DOC_COUNT} documents...")
        detected_count = 0
        total_tests = DOC_COUNT

        for doc in base_documents:
            original = doc["rawBytes"]
            corrupted = None

            if prof["id"] == "PROFILE_A":
                # Flip 1 byte at midpoint
                mid = len(original) // 2
                flipped_byte = bytes([original[mid] ^ 0x01])
                corrupted = original[:mid] + flipped_byte + original[mid+1:]

            elif prof["id"] == "PROFILE_B":
                # Truncate last 15%
                cut_len = int(len(original) * 0.85)
                corrupted = original[:cut_len]

            elif prof["id"] == "PROFILE_C":
                # Metadata modification
                corrupted = original.replace(b"Govt Land Registry", b"Unauthorized Issuer")

            elif prof["id"] == "PROFILE_D":
                # Complete file replacement
                corrupted = f"%PDF-1.4 FORGED DEED DOC {doc['docId']} SUBSTITUTE".encode("utf-8")

            corrupted_hash = sha256_hex(corrupted)
            # Tamper detected if corrupted_hash != expectedHash
            if corrupted_hash != doc["expectedHash"]:
                detected_count += 1

        accuracy = (detected_count / total_tests) * 100.0
        results.append({
            "profileId": prof["id"],
            "name": prof["name"],
            "description": prof["description"],
            "documentsTested": total_tests,
            "tamperDetected": detected_count,
            "tamperUndetected": total_tests - detected_count,
            "detectionRate": f"{accuracy:.1f}%"
        })

    # Summary table
    print("\n==========================================================================================================")
    print(" RQ5 DOCUMENT INTEGRITY & TAMPER DETECTION EXPERIMENTAL RESULTS")
    print("==========================================================================================================")
    print(
        "Profile ID".ljust(14) +
        "Tampering Profile".ljust(48) +
        "Tested".ljust(10) +
        "Detected".ljust(12) +
        "Detection Rate"
    )
    print("-" * 98)
    for r in results:
        print(
            r["profileId"].ljust(14) +
            r["name"].ljust(48) +
            str(r["documentsTested"]).ljust(10) +
            str(r["tamperDetected"]).ljust(12) +
            r["detectionRate"]
        )
    print("==========================================================================================================\n")

    # Export JSON artifact
    out_json = Path(__file__).parent.parent / "docs" / "benchmark_rq5_document_integrity.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"[+] Wrote RQ5 JSON benchmark artifact to: {out_json}")

    # Export CSV artifact
    out_csv = Path(__file__).parent.parent / "docs" / "benchmark_rq5_document_integrity.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Profile_ID", "Name", "Description", "Documents_Tested", "Tamper_Detected", "Detection_Rate"])
        for r in results:
            writer.writerow([r["profileId"], r["name"], r["description"], r["documentsTested"], r["tamperDetected"], r["detectionRate"]])
    print(f"[+] Wrote RQ5 CSV benchmark artifact to: {out_csv}\n")

if __name__ == "__main__":
    run_document_integrity_experiment()
