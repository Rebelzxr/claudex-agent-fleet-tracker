#!/usr/bin/env bash
# Regex grep over the source tree; findings name only the rule and line.
set -euo pipefail
SCAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$SCAN_ROOT/scripts/privacy_scan.py" "${1:-$SCAN_ROOT}"
