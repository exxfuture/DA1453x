#!/usr/bin/env bash
# Publish a single synthetic temperature reading to the local MQTT broker —
# a quick, no-hardware-needed way to poke the ingest pipeline manually.
# For a continuously-running fake device instead, use the gateway-N services
# in ../docker-compose.yml (already running in --simulate mode).
#
# The broker requires credentials (deploy/mosquitto/mosquitto.conf): this
# script authenticates as the `collector` client the backend provisions,
# whose password is MQTT_COLLECTOR_PASSWORD (.env / compose default
# `collector-dev`), and publishes under the `collector` user segment — the
# only one that client's ACL allows.
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
USER_SEGMENT="collector"
TOPIC="v1/${TENANT}/${USER_SEGMENT}/${DEVICE_ID}/measurement/temperature"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MQTT_USER="collector"
MQTT_PASSWORD="${MQTT_COLLECTOR_PASSWORD:-collector-dev}"

PAYLOAD="{\"v\":1,\"device_id\":\"${DEVICE_ID}\",\"collector_id\":\"simulate-device.sh\",\"ts\":\"${TS}\",\"type\":\"temperature\",\"payload\":{\"celsius\":${CELSIUS}}}"

echo "Publishing to ${TOPIC} as ${MQTT_USER}:"
echo "${PAYLOAD}"
echo

docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T mosquitto \
  mosquitto_pub -h localhost -p 1883 -u "${MQTT_USER}" -P "${MQTT_PASSWORD}" \
  -t "${TOPIC}" -q 1 -m "${PAYLOAD}"

echo "Published. Check it landed (needs a Keycloak token — see deploy/README.md):"
echo "  curl -H \"Authorization: Bearer \$TOKEN\" \"http://localhost:8080/api/measurements/${DEVICE_ID}?type=temperature\""
