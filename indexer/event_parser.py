from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass
from web3 import Web3
from hexbytes import HexBytes
from eth_utils import event_abi_to_log_topic
from web3._utils.events import get_event_data

from indexer.abi_loader import get_contract_abi

@dataclass
class ParsedEvent:
    contract_name: str
    contract_address: str
    event_name: str
    args: Dict[str, Any]
    block_number: int
    block_hash: str
    transaction_hash: str
    log_index: int

def serialize_arg(val: Any) -> Any:
    """Recursively converts bytes, HexBytes, and sequences into JSON-serializable primitives."""
    if isinstance(val, (bytes, HexBytes)):
        return "0x" + val.hex()
    elif isinstance(val, (list, tuple)):
        return [serialize_arg(v) for v in val]
    elif isinstance(val, dict):
        return {k: serialize_arg(v) for k, v in val.items()}
    return val

class EventParser:
    """
    Decodes raw EVM logs into structured domain events using compiled contract ABIs.
    """
    def __init__(self, w3: Optional[Web3] = None):
        self.w3 = w3 or Web3()
        self.contracts = ["IdentityRegistry", "InspectorRegistry", "LandRegistry", "TransferEscrow"]
        # Map: topic0_hex -> (contract_name, event_name, event_abi)
        self.topic_map: Dict[str, Tuple[str, str, Dict[str, Any]]] = {}
        self._build_topic_map()

    def _build_topic_map(self):
        for name in self.contracts:
            abi = get_contract_abi(name)
            for item in abi:
                if item.get("type") == "event":
                    event_name = item.get("name")
                    topic = "0x" + event_abi_to_log_topic(item).hex()
                    self.topic_map[topic.lower()] = (name, event_name, item)

    def parse_log(self, log: Dict[str, Any], contract_name_hint: Optional[str] = None) -> Optional[ParsedEvent]:
        """
        Parses a single Web3 log dictionary. Returns None if log does not match our known topics.
        """
        topics = log.get("topics", [])
        if not topics:
            return None

        topic0 = topics[0]
        if isinstance(topic0, (bytes, HexBytes)):
            topic0_hex = "0x" + topic0.hex().lower()
        else:
            topic0_hex = str(topic0).lower()

        if topic0_hex not in self.topic_map:
            return None

        contract_name, event_name, event_abi = self.topic_map[topic0_hex]

        try:
            event_data = get_event_data(self.w3.codec, event_abi, log)
            raw_args = dict(event_data.get("args", {}))
            serialized_args = {k: serialize_arg(v) for k, v in raw_args.items()}

            block_hash = log.get("blockHash")
            if isinstance(block_hash, (bytes, HexBytes)):
                block_hash = "0x" + block_hash.hex()

            tx_hash = log.get("transactionHash")
            if isinstance(tx_hash, (bytes, HexBytes)):
                tx_hash = "0x" + tx_hash.hex()

            contract_addr = log.get("address", "")
            if isinstance(contract_addr, (bytes, HexBytes)):
                contract_addr = "0x" + contract_addr.hex()

            return ParsedEvent(
                contract_name=contract_name,
                contract_address=str(contract_addr).lower(),
                event_name=event_name,
                args=serialized_args,
                block_number=int(log.get("blockNumber", 0)),
                block_hash=str(block_hash),
                transaction_hash=str(tx_hash),
                log_index=int(log.get("logIndex", 0))
            )
        except Exception:
            return None

event_parser = EventParser()
