import subprocess
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
CONTRACTS_DIR = ROOT_DIR / "contracts"

def run_step(step_name: str, cmd: list, cwd: Path):
    print("\n" + "=" * 90)
    print(f" RUNNING: {step_name}")
    print(f" Command: {' '.join(cmd)} (Cwd: {cwd})")
    print("=" * 90 + "\n")
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=str(cwd), shell=(sys.platform == "win32"))
    t1 = time.perf_counter()
    if proc.returncode != 0:
        print(f"[-] FAILED: {step_name} with exit code {proc.returncode}")
        sys.exit(proc.returncode)
    print(f"[+] COMPLETED: {step_name} in {t1 - t0:.2f}s")

def main():
    print("================================================================================")
    print(" CADASTRA EMPIRICAL RESEARCH HARNESS (PHASE 10: RQ1 - RQ6 + GAS PROFILING)")
    print(" Orchestrating All Research Experiments for Academic Paper Evidence")
    print("================================================================================\n")
    
    t_start = time.perf_counter()

    # 1. Smart Contract Gas Profiling
    run_step(
        "Gas Consumption Profiler (Contracts)",
        ["npx", "hardhat", "run", "scripts/gas_profiler.js"],
        CONTRACTS_DIR
    )

    # 2. RQ1: Inspector Governance & Hierarchy
    run_step(
        "RQ1: Inspector Authorization & Hierarchy Experiment",
        ["npx", "hardhat", "run", "scripts/experiment_rq1_authorization.js"],
        CONTRACTS_DIR
    )

    # 3. RQ2: Duplicate & Spatial Overlap Detection
    run_step(
        "RQ2: Cadastral Duplicate & Spatial Overlap Benchmark",
        [sys.executable, "scripts/generate_synthetic_parcels.py"],
        ROOT_DIR
    )

    # 4. RQ3: Escrow State Machine & Custody (TC01-TC10)
    run_step(
        "RQ3: Escrow Test Cases (TC01-TC10) Experiment",
        ["npx", "hardhat", "run", "scripts/experiment_rq3_escrow.js"],
        CONTRACTS_DIR
    )

    # 5. RQ4: Event Synchronization & Reconciliation
    run_step(
        "RQ4: Event Synchronization & Tamper Self-Healing Experiment",
        [sys.executable, "scripts/experiment_rq4_synchronization.py"],
        ROOT_DIR
    )

    # 6. RQ5: Document Integrity & Tamper Detection
    run_step(
        "RQ5: Document Integrity & Cryptographic Tamper Experiment",
        [sys.executable, "scripts/experiment_rq5_document_integrity.py"],
        ROOT_DIR
    )

    # 7. RQ6: Read Scalability & Dashboard Latency
    run_step(
        "RQ6: Read Scalability & Latency Benchmark",
        [sys.executable, "scripts/experiment_rq6_read_scaling.py"],
        ROOT_DIR
    )

    total_time = time.perf_counter() - t_start
    print("\n" + "=" * 90)
    print(f" ALL 7 EMPIRICAL BENCHMARKS EXECUTED SUCCESSFULLY IN {total_time:.2f}s!")
    print(" Benchmark Artifacts Generated:")
    print("   - docs/benchmark_gas_profile.json & .csv")
    print("   - docs/benchmark_rq1_authorization.json")
    print("   - docs/benchmark_rq2_geospatial.json")
    print("   - docs/benchmark_rq3_escrow.json & .csv")
    print("   - docs/benchmark_rq4_synchronization.json & .csv")
    print("   - docs/benchmark_rq5_document_integrity.json & .csv")
    print("   - docs/benchmark_rq6_read_scaling.json & .csv")
    print("=" * 90 + "\n")

if __name__ == "__main__":
    main()
