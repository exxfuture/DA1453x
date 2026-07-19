#!/usr/bin/env bash
# Build and run the host-side codec unit tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${SCRIPT_DIR}/test_codec"

cc -std=c99 -Wall -Wextra -Werror -O2 \
    -o "${OUT}" "${SCRIPT_DIR}/test_codec.c"

"${OUT}"
