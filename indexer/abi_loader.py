import json
from pathlib import Path
from typing import Dict, Any, List

# Root directory of the repository
ROOT_DIR = Path(__file__).resolve().parent.parent

ARTIFACT_PATHS = {
    "IdentityRegistry": ROOT_DIR / "contracts" / "artifacts" / "src" / "IdentityRegistry.sol" / "IdentityRegistry.json",
    "InspectorRegistry": ROOT_DIR / "contracts" / "artifacts" / "src" / "InspectorRegistry.sol" / "InspectorRegistry.json",
    "LandRegistry": ROOT_DIR / "contracts" / "artifacts" / "src" / "LandRegistry.sol" / "LandRegistry.json",
    "TransferEscrow": ROOT_DIR / "contracts" / "artifacts" / "src" / "TransferEscrow.sol" / "TransferEscrow.json",
}

DEPLOYMENT_ABI_PATHS = {
    "IdentityRegistry": ROOT_DIR / "deployments" / "abi" / "IdentityRegistry.json",
    "InspectorRegistry": ROOT_DIR / "deployments" / "abi" / "InspectorRegistry.json",
    "LandRegistry": ROOT_DIR / "deployments" / "abi" / "LandRegistry.json",
    "TransferEscrow": ROOT_DIR / "deployments" / "abi" / "TransferEscrow.json",
}

_ABI_CACHE: Dict[str, List[Dict[str, Any]]] = {}

def get_contract_abi(contract_name: str) -> List[Dict[str, Any]]:
    """Loads and caches contract ABI from deployments or Hardhat artifact JSON."""
    if contract_name in _ABI_CACHE:
        return _ABI_CACHE[contract_name]

    if contract_name not in ARTIFACT_PATHS:
        raise ValueError(f"Unknown contract: {contract_name}. Expected one of {list(ARTIFACT_PATHS.keys())}")

    # Check deployments/abi first
    deploy_file = DEPLOYMENT_ABI_PATHS.get(contract_name)
    if deploy_file and deploy_file.exists():
        with open(deploy_file, "r", encoding="utf-8") as f:
            abi = json.load(f)
            _ABI_CACHE[contract_name] = abi
            return abi

    # Fallback to contracts/artifacts
    artifact_file = ARTIFACT_PATHS[contract_name]
    if not artifact_file.exists():
        raise FileNotFoundError(f"Artifact not found at {artifact_file} or {deploy_file}. Ensure contracts have been compiled (`npm run compile`).")

    with open(artifact_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    abi = data.get("abi", [])
    _ABI_CACHE[contract_name] = abi
    return abi
