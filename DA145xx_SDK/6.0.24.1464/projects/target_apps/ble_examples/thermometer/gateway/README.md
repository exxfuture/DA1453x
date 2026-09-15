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

- Go 1.26+ (matches the `go` directive in `go.mod`, which is also what the
  Dockerfile's builder image and the CI workflow use)
- Docker (for the containerized build/run, and for local testing against a
  real broker)

## Build

```bash
go build .
```

## Test

```bash
go vet ./...
go test ./...          # add -race for the concurrent paths (metrics + ring buffer)
```

What the suite covers:

| Package | Covers |
|---------|--------|
| `internal/envelope` | envelope JSON shape, UTC timestamp normalisation, topic naming, segment validation (wildcards/separators/NUL/whitespace rejected), non-finite and implausible temperatures rejected, **and validation of the marshalled envelope — with and without `meta` — against the shared JSON Schema at `../schema/measurement-envelope.v1.schema.json`** |
| `internal/mqtt` | connect + QoS 1 publish against an **embedded broker that requires credentials**, wrong-password and anonymous connects refused, unreachable broker, connect/publish timeout against a broker that never acknowledges, cancellation, `Disconnect` on an unresponsive broker |
| `internal/buffer` | FIFO order, drop-oldest when full, wrap-around, concurrent access |
| `internal/metrics` | counters and the Prometheus text output |
| `internal/sensor` | plausible + deterministic synthetic readings, simulated battery drain and RSSI, cancelled context, BlueZ stub error |
| `main` (loop) | flag/env precedence and defaults, the refusal to start without a broker password, meta populated from the source, buffering during an outage and in-order replay, drop accounting, sensor/schema failures, `/metrics` endpoint, and a clean shutdown while a publish is stuck on a broker that never acks |

The embedded broker is [`mochi-mqtt/server`](https://github.com/mochi-mqtt/server)
running in-process, and the schema validator is
[`santhosh-tekuri/jsonschema`](https://github.com/santhosh-tekuri/jsonschema) —
both used only from `_test.go` files, so no Docker and no external broker are
needed to run the suite (`go.mod` cannot mark them test-only, but nothing in
the binary imports them).

## Run

The broker requires credentials: Mosquitto runs with the dynamic-security
plugin and `allow_anonymous false`, the backend provisions a `collector`
client whose role may publish to `v1/+/collector/+/measurement/+` and nothing
else, and the gateway authenticates as that client. **Without a password the
gateway refuses to start** (rather than failing later with an opaque broker
error):

```bash
GATEWAY_MQTT_PASSWORD=collector-dev go run . \
  --broker-url tcp://localhost:1883 \
  --device-id AA:BB:CC:DD:EE:01 \
  --interval 5s \
  --metrics-addr :9100
```

By default this runs in `--simulate` mode — see "What's implemented" below —
which is enough to exercise the entire pipeline without real hardware.

### Flags and environment variables

Every flag with a `GATEWAY_*` name can be set either way; the flag wins over
the environment variable.

| Flag | Env var | Default | Purpose |
|------|---------|---------|---------|
| `--broker-url` | `GATEWAY_BROKER_URL` | `tcp://localhost:1883` | Mosquitto/EMQX broker |
| `--mqtt-username` | `GATEWAY_MQTT_USERNAME` | `collector` | broker identity; the broker's `collector` role is what permits publishing |
| `--mqtt-password` | `GATEWAY_MQTT_PASSWORD` | *(empty — startup fails)* | the `collector` client's password (`THERMOMETER_MQTT_COLLECTOR_PASSWORD` on the backend side) |
| `--allow-anonymous` | *(flag only, on purpose)* | `false` | connect with no credentials; only for a broker deliberately run with `allow_anonymous true` |
| `--device-id` | `GATEWAY_DEVICE_ID` | `AA:BB:CC:DD:EE:01` | BD address reported in the envelope and in the topic |
| `--tenant` | `GATEWAY_TENANT` | `default` | tenant topic segment (no multi-tenant model wired up yet) |
| `--user` | `GATEWAY_USER` | `collector` | user topic segment — **`collector` is the only value the broker ACL allows for a gateway** (see below) |
| `--collector-id` | `GATEWAY_COLLECTOR_ID` | `gateway-01` | reported in the envelope's `collector_id` |
| `--interval` | *(flag only)* | `5s` | measurement interval |
| `--mqtt-timeout` | *(flag only)* | `10s` | per-connect / per-publish timeout |
| `--buffer-size` | `GATEWAY_BUFFER_SIZE` | `256` | readings retained in memory while the broker is unreachable |
| `--metrics-addr` | `GATEWAY_METRICS_ADDR` | *(empty — endpoint off)* | listen address for `/metrics`, e.g. `:9100` |
| `--simulate` | *(flag only)* | `true` | synthetic readings vs. real BlueZ (see below) |

Values used in a topic (`--tenant`, `--user`, `--device-id`) are validated at
startup against a strict allowlist (letters, digits, `-`, `_`, `.`, `:`), so a
value can never inject an MQTT wildcard (`+`, `#`), a level separator (`/`),
NUL or whitespace into the topic.

### The `collector` topic segment

Gateways publish to `v1/{tenant}/collector/{device_id}/measurement/{type}`.
The broker's dynamic-security `collector` role allows exactly
`v1/+/collector/+/measurement/+`, so any other `--user` value is refused by
the broker, not silently accepted — the gateway logs a warning at startup if
you set one. The user segment of the topic is *not* an end-user identity for
this collector: the backend's ingest rule treats `collector` as the trusted
collector path (self-registering unclaimed devices), while a topic whose user
segment is a local user id is only accepted for that user's own (or an
unclaimed) device. Browser collectors publish under their own user id; this
one does not.

### Buffering and metrics

A publish failure no longer loses the reading. Each tick:

1. replays anything buffered earlier, oldest first, stopping at the first
   failure so the broker always sees readings in the order they were taken;
2. publishes the fresh reading;
3. buffers it if either step failed.

The buffer is a bounded in-memory ring (`--buffer-size`, default 256 ≈ 21
minutes at the default interval). It is deliberately *not* a disk queue: an
edge SBC must not trade a broker outage for an out-of-memory kill, and
readings are small, frequent and gap-tolerant downstream. When the ring is
full the oldest reading is dropped and counted, and anything still buffered at
shutdown is lost — the shutdown log line says how much.

`--metrics-addr` exposes the counters in Prometheus text format at `/metrics`
(also served at `/` for a quick `curl`), written by hand so the binary keeps
no metrics dependency:

```
gateway_published_total 41
gateway_publish_failures_total 3
gateway_buffered_total 3
gateway_dropped_total 0
gateway_sensor_read_failures_total 0
gateway_buffer_depth 0
gateway_buffer_capacity 256
```

Without the endpoint the same numbers are logged on shutdown and on every
10th publish failure, so a sustained outage is visible in `docker logs` alone.

## Docker

```bash
docker build -t thermometer-gateway .
docker run --rm \
  -e GATEWAY_BROKER_URL=tcp://mosquitto:1883 \
  -e GATEWAY_MQTT_PASSWORD=collector-dev \
  thermometer-gateway
```

The image runs as the unprivileged `gateway` user (uid 10001) — verify with
`docker run --rm --entrypoint id thermometer-gateway`. Both stages use
multi-arch base images, so the same Dockerfile produces an arm64 image on a
Raspberry Pi (or via `docker buildx build --platform linux/arm64`).

Or via `../docker-compose.yml` (`docker compose up gateway-1`), which runs it
against the compose-managed Mosquitto in `--simulate` mode with the dev
`collector` password — a convenient way to have "devices" continuously
producing data for local FE/backend testing without pairing real hardware.

## CI

`.github/workflows/gateway.yml` runs `go build ./...`, `go vet ./...`,
`go test ./...`, a `go mod tidy` diff check, the container build, and a check
that the image does not run as root — on every push/PR touching `gateway/**`
or the shared `schema/**`.

## What's implemented vs. scaffolded

| Area | Status |
|------|--------|
| Envelope construction + MQTT QoS 1 publish | ✅ implemented, tested (incl. against the shared JSON Schema and an embedded broker), smoke-tested against a real broker |
| Input validation (topic segments, non-finite/implausible temperatures) | ✅ implemented, tested |
| Broker authentication as the `collector` client | ✅ implemented — username/password from `--mqtt-username`/`--mqtt-password` (`GATEWAY_MQTT_*`), supplied through `internal/auth.TokenProvider` on every (re)connect; the gateway refuses to start without a password unless `--allow-anonymous` is passed explicitly |
| Bounded connect/publish waits + graceful shutdown (SIGINT/SIGTERM) | ✅ implemented, tested — a broker that accepts TCP but never acknowledges cannot hang the loop or block shutdown |
| Bounded retry buffer + counters + `/metrics` | ✅ implemented, tested |
| Synthetic sensor (`internal/sensor/simulator.go`) incl. simulated `meta.battery_pct` / `meta.rssi_dbm` | ✅ implemented — plausible drifting readings, deterministic per seed, battery draining ~2 %/h from 100 % and a fake RSSI around −58 dBm. **These are synthetic**: the BlueZ source will report the real battery level (Battery Service) and the adapter's real RSSI. |
| Non-root container image | ✅ implemented (uid 10001) |
| Real BlueZ HTP subscription (`internal/sensor/bluez.go`) | ⏸ **not implemented** — returns a clear error; the `sensor.Source` interface (now context-aware) is already in place so this is a contained addition later, not a redesign |
| Short-lived, renewed device credential (architecture v3 §8.2) | ⏸ **not implemented** — the gateway holds a long-lived shared `collector` password from configuration. `internal/auth.TokenProvider` is the seam: it is consulted per connection attempt, so a provider that fetches/renews a backend-minted credential (the way `POST /api/live/credentials` already mints short-lived ones for browser clients) drops in without touching the MQTT or loop code. There is no gateway-facing mint endpoint yet. |
| mTLS / `mqtts://` transport | ⏸ not implemented — `ca-certificates` is in the image so a TLS broker URL is one flag away, but nothing here configures certificates |
| Disk-backed queue surviving a gateway restart | ⏸ not implemented, deliberately — see "Buffering and metrics" |

## Source layout

```
main.go                      CLI flags/env, config validation, main loop (read → encode → flush → publish → buffer),
                             /metrics endpoint wiring, graceful shutdown
internal/
├── envelope/envelope.go     Shared wire format, topic naming and input validation
│                            (schema_test.go validates it against ../schema/measurement-envelope.v1.schema.json)
├── sensor/
│   ├── source.go            Source interface (context-aware) + Reading, incl. optional battery/RSSI meta
│   ├── simulator.go         Synthetic reading generator (default), incl. simulated battery drain + RSSI
│   └── bluez.go             Real BlueZ integration — stubbed, not implemented
├── mqtt/publisher.go        Paho wrapper: credentialed connect, QoS 1 publish, every wait bounded by context + timeout
├── buffer/ring.go           Bounded FIFO retry buffer (drop-oldest, counted)
├── metrics/metrics.go       Counters + Prometheus text endpoint
└── auth/token.go            TokenProvider: supplies the broker password; the seam for a renewable credential
```
