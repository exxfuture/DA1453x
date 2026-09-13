# thermometer-gateway

Optional headless BLE collector (architecture v3 §7 / v1 §5.3): a small Go
binary meant to run on a Raspberry Pi or similar SBC via BlueZ, for
unattended sites where a phone isn't always present. Publishes the same
[shared measurement envelope](../ARCHITECTURE_V3.html#pipeline) as the
mobile and web collectors, over MQTT.

Stays Go even though the platform backend moved to Java/Spring Boot — see
`../ARCHITECTURE_V3.html` §2.3: an edge SBC is a different deployment target
(constrained RAM, no JVM to install and patch in the field, trivial
cross-compilation to arm/arm64), not a second backend language competing
with the first.

## Prerequisites

- Go 1.24+ (matches the `go` directive in `go.mod`)
- Docker (for the containerized build/run, and for local testing against a
  real broker)

## Build

```bash
go build .
```

## Test

```bash
go vet ./...
go test ./... -v
```

Covers: envelope JSON shape matches the shared wire schema, topic naming,
the synthetic simulator produces plausible/deterministic readings, and the
(stand-in) token provider.

## Run

By default this runs in `--simulate` mode — see "What's implemented" below —
which is enough to exercise the entire pipeline without real hardware:

```bash
go run . \
  --broker-url tcp://localhost:1883 \
  --device-id AA:BB:CC:DD:EE:01 \
  --interval 5s
```

Flags (`--broker-url`, `--device-id`, `--tenant`, `--user` and `--collector-id` are also settable via `GATEWAY_*` env vars — see `--help`; `--interval` and the mode flags are flag-only):

| Flag | Default | Purpose |
|------|---------|---------|
| `--broker-url` | `tcp://localhost:1883` | Mosquitto/EMQX broker |
| `--device-id` | `AA:BB:CC:DD:EE:01` | BD address reported in the envelope |
| `--tenant` / `--user` | `default` / `local-dev-user` | MQTT topic segments (no multi-tenant model wired up yet) |
| `--collector-id` | `gateway-01` | reported in the envelope's `collector_id` |
| `--interval` | `5s` | measurement interval |
| `--simulate` | `true` | synthetic readings vs. real BlueZ (see below) |

This was smoke-tested against a real Mosquitto container during development:
readings published on `v1/default/local-dev-user/{device_id}/measurement/temperature`
were observed arriving correctly-formed via `mosquitto_sub`.

## Docker

```bash
docker build -t thermometer-gateway .
docker run --rm thermometer-gateway --broker-url tcp://mosquitto:1883
```

Or via `../docker-compose.yml` (`docker compose up gateway`), which runs it
against the compose-managed Mosquitto in `--simulate` mode by default — a
convenient way to have a "device" continuously producing data for local FE/
backend testing without pairing real hardware.

## What's implemented vs. scaffolded

| Area | Status |
|------|--------|
| Envelope construction + MQTT QoS 1 publish | ✅ implemented, tested, smoke-tested against a real broker |
| Synthetic sensor (`internal/sensor/simulator.go`) | ✅ implemented — plausible drifting readings, deterministic per seed |
| Graceful shutdown (SIGINT/SIGTERM) | ✅ implemented |
| Real BlueZ HTP subscription (`internal/sensor/bluez.go`) | ⏸ **not implemented** — returns a clear error; the `sensor.Source` interface is already in place so this is a contained addition later, not a redesign |
| JWT-based auth renewal (architecture v3 §8.2) | ⏸ **not implemented** — `internal/auth.TokenProvider` is the seam; there's no backend endpoint yet to fetch/renew a real token from, so `StaticTokenProvider` is a stand-in. Local Mosquitto runs with anonymous access enabled (see `../deploy/mosquitto.conf`), matching how the backend's `local` profile also disables auth for local development ease. |
| mTLS (optional hardening layer) | ⏸ not implemented |

## Source layout

```
main.go                      CLI flags, main loop, graceful shutdown
internal/
├── envelope/envelope.go     Shared wire format + topic naming (mirrors the backend's MeasurementEnvelope)
├── sensor/
│   ├── source.go            Source interface
│   ├── simulator.go         Synthetic reading generator (default)
│   └── bluez.go             Real BlueZ integration — stubbed, not implemented
├── mqtt/publisher.go        Thin wrapper over eclipse/paho.mqtt.golang
└── auth/token.go            TokenProvider seam for the not-yet-built renewal flow
```
