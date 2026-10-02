import asyncio
import argparse
import sys
import json
from indexer.service import EventIndexer
from indexer.reconciliation import reconciliation_engine

def main():
    parser = argparse.ArgumentParser(description="Blockchain Land Registry - Event Indexer CLI")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Command: run (daemon)
    run_parser = subparsers.add_parser("run", help="Start continuous indexing daemon")

    # Command: backfill
    backfill_parser = subparsers.add_parser("backfill", help="Backfill events from blockchain")
    backfill_parser.add_argument("--from-block", type=int, required=True, help="Starting block number")
    backfill_parser.add_argument("--to-block", type=int, required=True, help="Ending block number")

    # Command: status
    status_parser = subparsers.add_parser("status", help="Display current indexing status and lag")

    # Command: reconcile
    reconcile_parser = subparsers.add_parser("reconcile", help="Run consistency reconciliation check against smart contracts")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    indexer = EventIndexer()

    if args.command == "run":
        try:
            asyncio.run(indexer.run_daemon())
        except KeyboardInterrupt:
            print("\nShutting down indexer daemon cleanly...")

    elif args.command == "backfill":
        print(f"Starting historical backfill from block {args.from_block} to {args.to_block}...")
        count = asyncio.run(indexer.sync_range(args.from_block, args.to_block))
        print(f"Backfill complete! Processed {count} event(s).")

    elif args.command == "status":
        status_data = asyncio.run(indexer.get_sync_status())
        print(json.dumps(status_data, indent=2))

    elif args.command == "reconcile":
        print("Running full database <-> smart contract reconciliation audit...")
        report = asyncio.run(reconciliation_engine.run_full_reconciliation())
        print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
