// Command gateway is the optional headless BLE collector (architecture v3
// §7/§5.3): a Go binary meant for a Raspberry Pi or similar SBC running
// BlueZ, for unattended sites where a phone isn't always present. Stays Go
// even though the platform backend moved to Java — a resource-constrained
// edge device is a different problem from a data-center container (see
// ../ARCHITECTURE_V3.html §2.3).
//
// The real BlueZ sensor source isn't implemented yet (see
// internal/sensor/bluez.go) — this binary runs against a synthetic
// Simulator by default, which is enough to exercise and test the whole
// gateway -> broker -> backend -> API pipeline locally without hardware.
//
// Operationally the loop is: read one measurement per tick, build the shared
// envelope, publish it at QoS 1. Everything that can stall is bounded by the
// process context (INF-05), a failed publish is retained in a bounded
// in-memory buffer and replayed in order on the next successful tick
// (INF-11), and the broker connection is authenticated as the `collector`
// client the backend provisions (INF-04).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"thermometer-gateway/internal/auth"
	"thermometer-gateway/internal/buffer"
	"thermometer-gateway/internal/envelope"
	"thermometer-gateway/internal/metrics"
	"thermometer-gateway/internal/mqtt"
	"thermometer-gateway/internal/sensor"
)

const (
	// measurementType is the only type this collector produces today.
	measurementType = "temperature"

	// collectorTopicSegment is the user segment of the MQTT topic every
	// gateway publishes under. The broker's dynamic-security `collector` role
	// allows publishing to v1/+/collector/+/measurement/+ and nothing else, so
	// any other value is refused by the broker (see gateway/README.md).
	collectorTopicSegment = "collector"

	// defaultBufferSize is a few minutes of readings at the default interval —
	// enough to ride out a broker restart without risking an edge device's RAM.
	defaultBufferSize = 256

	// failureLogEvery is how often a sustained outage logs the counter summary,
	// for operators without a Prometheus scrape of --metrics-addr.
	failureLogEvery = 10

	// metricsShutdownTimeout bounds waiting for in-flight scrapes at exit.
	metricsShutdownTimeout = 2 * time.Second
)

type config struct {
	brokerURL      string
	deviceID       string
	tenant         string
	user           string
	collectorID    string
	mqttUsername   string
	mqttPassword   string
	allowAnonymous bool
	interval       time.Duration
	mqttTimeout    time.Duration
	simulate       bool
	bufferSize     int
	metricsAddr    string
}

func main() {
	cfg, err := parseFlags(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		log.Fatalf("invalid arguments: %v", err)
	}
	if err := cfg.validate(); err != nil {
		log.Fatalf("invalid configuration: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, cfg); err != nil {
		log.Fatal(err)
	}
}

func parseFlags(args []string) (config, error) {
	fs := flag.NewFlagSet("gateway", flag.ContinueOnError)
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "thermometer-gateway — headless BLE collector: reads a thermometer and publishes\n"+
			"the shared measurement envelope to MQTT. See gateway/README.md.\n\nFlags:\n")
		fs.PrintDefaults()
	}

	var cfg config
	fs.StringVar(&cfg.brokerURL, "broker-url", envOr("GATEWAY_BROKER_URL", "tcp://localhost:1883"), "MQTT broker URL")
	fs.StringVar(&cfg.deviceID, "device-id", envOr("GATEWAY_DEVICE_ID", "AA:BB:CC:DD:EE:01"), "BD address of the device")
	fs.StringVar(&cfg.tenant, "tenant", envOr("GATEWAY_TENANT", "default"), "tenant segment of the MQTT topic")
	fs.StringVar(&cfg.user, "user", envOr("GATEWAY_USER", collectorTopicSegment), "user segment of the MQTT topic; the broker's collector role only permits \"collector\"")
	fs.StringVar(&cfg.collectorID, "collector-id", envOr("GATEWAY_COLLECTOR_ID", "gateway-01"), "collector_id reported in the envelope")
	fs.StringVar(&cfg.mqttUsername, "mqtt-username", envOr("GATEWAY_MQTT_USERNAME", collectorTopicSegment), "broker username")
	fs.StringVar(&cfg.mqttPassword, "mqtt-password", os.Getenv("GATEWAY_MQTT_PASSWORD"), "broker password (required: the broker runs with allow_anonymous false)")
	fs.BoolVar(&cfg.allowAnonymous, "allow-anonymous", false, "connect without credentials; only for a broker deliberately run with allow_anonymous true")
	fs.DurationVar(&cfg.interval, "interval", 5*time.Second, "measurement interval")
	fs.DurationVar(&cfg.mqttTimeout, "mqtt-timeout", 10*time.Second, "per-connect/per-publish timeout")
	fs.BoolVar(&cfg.simulate, "simulate", true, "generate synthetic readings instead of a real BlueZ scan (BlueZ path not implemented — see internal/sensor/bluez.go)")
	fs.IntVar(&cfg.bufferSize, "buffer-size", intEnvOr("GATEWAY_BUFFER_SIZE", defaultBufferSize), "readings retained in memory while the broker is unreachable")
	fs.StringVar(&cfg.metricsAddr, "metrics-addr", os.Getenv("GATEWAY_METRICS_ADDR"), "listen address for the Prometheus-style /metrics endpoint, e.g. :9100 (empty = disabled)")

	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	return cfg, nil
}

func (c config) validate() error {
	if c.brokerURL == "" {
		return errors.New("--broker-url must not be empty")
	}
	if c.interval <= 0 {
		return fmt.Errorf("--interval must be positive, got %s", c.interval)
	}
	if c.mqttTimeout <= 0 {
		return fmt.Errorf("--mqtt-timeout must be positive, got %s", c.mqttTimeout)
	}
	if c.bufferSize < 1 {
		return fmt.Errorf("--buffer-size must be at least 1, got %d", c.bufferSize)
	}
	if !c.allowAnonymous {
		if c.mqttUsername == "" {
			return errors.New("--mqtt-username / GATEWAY_MQTT_USERNAME must not be empty (the broker identity, normally \"collector\")")
		}
		if c.mqttPassword == "" {
			return errors.New("no broker password: set --mqtt-password / GATEWAY_MQTT_PASSWORD to the `collector` client's password " +
				"(the broker runs with allow_anonymous false — see gateway/README.md), or pass --allow-anonymous to connect without credentials anyway")
		}
	}
	// The topic segments are validated here too so a bad value fails at
	// startup rather than on the first tick.
	if _, err := envelope.Topic(c.tenant, c.user, c.deviceID, measurementType); err != nil {
		return err
	}
	return nil
}

func run(ctx context.Context, cfg config) error {
	topic, err := envelope.Topic(cfg.tenant, cfg.user, cfg.deviceID, measurementType)
	if err != nil {
		return err
	}
	if cfg.user != collectorTopicSegment {
		log.Printf("warning: --user is %q; the broker's collector role only allows publishing under v1/+/%s/+/measurement/+, so these publishes will be refused",
			cfg.user, collectorTopicSegment)
	}

	source, err := buildSource(cfg.simulate, cfg.deviceID)
	if err != nil {
		return fmt.Errorf("sensor source unavailable: %w", err)
	}

	var credentials auth.TokenProvider
	if cfg.allowAnonymous {
		log.Printf("warning: --allow-anonymous, connecting to %s without credentials", cfg.brokerURL)
	} else {
		credentials = auth.NewStaticTokenProvider(cfg.mqttPassword)
	}

	broker, err := mqttConnect(ctx, cfg, credentials)
	if err != nil {
		return err
	}
	defer broker.Disconnect()

	c := &collector{
		source:      source,
		publisher:   broker,
		topic:       topic,
		deviceID:    cfg.deviceID,
		collectorID: cfg.collectorID,
		pending:     buffer.NewRing(cfg.bufferSize),
		stats:       &metrics.Counters{},
	}

	if cfg.metricsAddr != "" {
		stopMetrics, err := serveMetrics(cfg.metricsAddr, c)
		if err != nil {
			return err
		}
		defer stopMetrics()
	}

	log.Printf("publishing to %s every %s as %q (simulate=%v, buffer=%d, metrics=%q)",
		topic, cfg.interval, cfg.mqttUsername, cfg.simulate, cfg.bufferSize, cfg.metricsAddr)

	ticker := time.NewTicker(cfg.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("shutting down: %s (%d readings still buffered, lost on exit)",
				c.stats.Snapshot(), c.pending.Len())
			return nil
		case <-ticker.C:
			c.tick(ctx)
		}
	}
}

// publisher is the slice of internal/mqtt the loop needs, so the loop's
// buffering behaviour is testable against a fake (see main_test.go).
type publisher interface {
	Publish(ctx context.Context, topic string, payload []byte) error
	Disconnect()
}

// collector owns one tick of the main loop: read, encode, publish, and
// whatever bookkeeping a failure requires.
type collector struct {
	source      sensor.Source
	publisher   publisher
	topic       string
	deviceID    string
	collectorID string
	pending     *buffer.Ring
	stats       *metrics.Counters
}

// tick takes one reading and gets it (and anything an earlier tick buffered)
// to the broker. Buffered readings go first and a failure stops the flush, so
// the broker always sees readings in the order they were taken.
func (c *collector) tick(ctx context.Context) {
	reading, err := c.source.Read(ctx)
	if err != nil {
		c.stats.IncSensorFailures()
		log.Printf("sensor read failed: %v", err)
		return
	}

	env, err := envelope.NewTemperature(c.deviceID, c.collectorID, reading.Timestamp, reading.Celsius, metaFor(reading))
	if err != nil {
		// A reading the shared schema would reject is dropped here rather
		// than corrupting downstream aggregation (INF-16).
		c.stats.IncSensorFailures()
		log.Printf("discarding reading: %v", err)
		return
	}
	payload, err := json.Marshal(env)
	if err != nil {
		log.Printf("envelope marshal failed: %v", err)
		return
	}
	message := buffer.Message{Topic: c.topic, Payload: payload}

	if err := c.flush(ctx); err == nil {
		if err := c.send(ctx, message); err == nil {
			log.Printf("published %.2f°C to %s", reading.Celsius, c.topic)
			return
		}
	}
	c.retain(message)
}

// flush replays buffered messages oldest-first, stopping at the first failure
// so ordering survives a partial outage.
func (c *collector) flush(ctx context.Context) error {
	for {
		message, ok := c.pending.Peek()
		if !ok {
			return nil
		}
		if err := c.send(ctx, message); err != nil {
			return err
		}
		c.pending.Discard()
		log.Printf("replayed a buffered reading to %s (%d still pending)", message.Topic, c.pending.Len())
	}
}

func (c *collector) send(ctx context.Context, message buffer.Message) error {
	if err := c.publisher.Publish(ctx, message.Topic, message.Payload); err != nil {
		log.Printf("publish failed: %v", err)
		if failures := c.stats.IncPublishFailures(); failures%failureLogEvery == 0 {
			log.Printf("counters: %s", c.stats.Snapshot())
		}
		return err
	}
	c.stats.IncPublished()
	return nil
}

// retain keeps a reading for the next tick to replay. The buffer is bounded,
// so a long enough outage does lose the oldest readings — counted, not silent.
func (c *collector) retain(message buffer.Message) {
	if dropped := c.pending.Push(message); dropped {
		c.stats.IncDropped()
		log.Printf("retry buffer full at %d readings, dropped the oldest", c.pending.Cap())
	}
	c.stats.IncBuffered()
	log.Printf("buffered the reading for retry (%d/%d pending)", c.pending.Len(), c.pending.Cap())
}

// metaFor maps the optional context the source reported onto the envelope's
// meta object (schema: meta.battery_pct / meta.rssi_dbm). Returns nil when the
// source knew neither, so meta is omitted instead of sent as an empty object.
func metaFor(reading sensor.Reading) map[string]interface{} {
	meta := make(map[string]interface{}, 2)
	if reading.BatteryPct != nil {
		meta["battery_pct"] = *reading.BatteryPct
	}
	if reading.RSSIdBm != nil {
		meta["rssi_dbm"] = *reading.RSSIdBm
	}
	if len(meta) == 0 {
		return nil
	}
	return meta
}

// mqttConnect dials the broker with the credentials the TokenProvider
// supplies. credentials is nil only under --allow-anonymous.
func mqttConnect(ctx context.Context, cfg config, credentials auth.TokenProvider) (publisher, error) {
	connected, err := mqtt.Connect(ctx, mqtt.Options{
		BrokerURL:   cfg.brokerURL,
		ClientID:    "gateway-" + cfg.deviceID,
		Username:    cfg.mqttUsername,
		Credentials: credentials,
		Timeout:     cfg.mqttTimeout,
	})
	if err != nil {
		return nil, err
	}
	return connected, nil
}

func buildSource(simulate bool, deviceID string) (sensor.Source, error) {
	if simulate {
		return sensor.NewSimulator(time.Now().UnixNano()), nil
	}
	return sensor.NewBlueZSource(deviceID)
}

// serveMetrics starts the /metrics endpoint and returns a function that stops
// it. Binding happens synchronously so a bad address fails at startup.
func serveMetrics(addr string, c *collector) (func(), error) {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("metrics listener on %s: %w", addr, err)
	}

	server := &http.Server{
		Handler:           metrics.Handler(c.stats, c.pending),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("metrics endpoint stopped: %v", err)
		}
	}()
	log.Printf("metrics on http://%s/metrics", listener.Addr())

	return func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), metricsShutdownTimeout)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func intEnvOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil {
			log.Printf("warning: %s=%q is not a number, using %d", key, v, fallback)
			return fallback
		}
		return parsed
	}
	return fallback
}
