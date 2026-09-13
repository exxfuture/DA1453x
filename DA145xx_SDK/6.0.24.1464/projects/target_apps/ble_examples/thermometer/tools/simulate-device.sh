#!/usr/bin/env bash
# Publish a single synthetic temperature reading to the local MQTT broker —
# a quick, no-hardware-needed way to poke the ingest pipeline manually.
# For a continuously-running fake device instead, use the `gateway` service
# in ../docker-compose.yml (already runs in --simulate mode by default).
#
# Usage: ./simulate-device.sh [device_id] [celsius]
set -euo pipefail

DEVICE_ID="${1:-AA:BB:CC:DD:EE:99}"
CELSIUS="${2:-27.15}"
if ! [[ "${CELSIUS}" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
  echo "error: celsius must be a number (got '${CELSIUS}')" >&2
  exit 2
fi
TENANT="default"
USER_ID="local-dev-user"
TOPIC="v1/${TENANT}/${USER_ID}/${DEVICE_ID}/measurement/temperature"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="{\"v\":1,\"device_id\":\"${DEVICE_ID}\",\"collector_id\":\"simulate-device.sh\",\"ts\":\"${TS}\",\"type\":\"temperature\",\"payload\":{\"celsius\":${CELSIUS}}}"

echo "Publishing to ${TOPIC}:"
echo "${PAYLOAD}"
echo

docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T mosquitto \
  mosquitto_pub -h localhost -p 1883 -t "${TOPIC}" -q 1 -m "${PAYLOAD}"

echo "Published. Check it landed:"
echo "  curl \"http://localhost:8080/api/measurements/${DEVICE_ID}?type=temperature\""
