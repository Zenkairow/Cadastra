import hashlib
import uuid
from typing import Tuple

class IKYCAdapter:
    """Stable interface for KYC providers (Mock or Production UIDAI/DigiLocker)."""
    def verify_citizen(self, national_id: str, full_name: str) -> Tuple[str, str]:
        raise NotImplementedError

class MockKYCAdapter(IKYCAdapter):
    """
    Mock KYC Adapter for academic prototype testing.
    Generates opaque bytes32 platform identity IDs.
    Guarantees: Zero raw Aadhaar or national ID numbers are leaked to blockchain.
    """
    def verify_citizen(self, national_id: str, full_name: str) -> Tuple[str, str]:
        # Generate an opaque platform UUID for this citizen
        raw_seed = f"PROTOTYPE_SALT_{national_id.strip()}_{full_name.strip().upper()}"
        hasher = hashlib.sha256(raw_seed.encode("utf-8"))
        identity_id = "0x" + hasher.hexdigest()
        
        # Internal non-reversable KYC provider reference token
        kyc_reference = f"MOCK-KYC-{str(uuid.uuid4())[:8].upper()}"
        
        return identity_id, kyc_reference

kyc_adapter = MockKYCAdapter()
