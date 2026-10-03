"""
Cadastra Event Synchronization Indexer Daemon Runner
Compatible with Setup Guide runbook (python -m backend.app.indexer.runner)
"""

import sys
from indexer.cli import main

if __name__ == "__main__":
    # If no subcommand supplied, default to 'run' daemon
    if len(sys.argv) == 1:
        sys.argv.append("run")
    main()
