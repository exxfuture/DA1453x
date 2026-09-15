package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	mochi "github.com/mochi-mqtt/server/v2"
	mochiauth "github.com/mochi-mqtt/server/v2/hooks/auth"
	"github.com/mochi-mqtt/server/v2/listeners"
	"github.com/mochi-mqtt/server/v2/packets"

	"thermometer-gateway/internal/buffer"
	"thermometer-gateway/internal/metrics"
	"thermometer-gateway/internal/sensor"
)

// TestMain keeps the loop's operational logging out of the test output; the
// assertions look at counters and delivered payloads, not at log lines.
func TestMain(m *testing.M) {
	log.SetOutput(io.Discard)
	os.Exit(m.Run())
}

// --- doubles -----------------------------------------------------------------

type fakePublisher struct {
	mu           sync.Mutex
	failing      bool
	sent         []buffer.Message
	disconnected bool
}

func (f *fakePublisher) Publish(_ context.Context, topic string, payload []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.failing {
		return errors.New("simulated broker outage")
	}
	f.sent = append(f.sent, buffer.Message{Topic: topic, Payload: append([]byte(nil), payload...)})
	return nil
}

func (f *fakePublisher) Disconnect() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.disconnected = true
}

func (f *fakePublisher) setFailing(failing bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failing = failing
}

// celsiusSent is the temperature of every envelope the publisher accepted, in
// the order it accepted them.
func (f *fakePublisher) celsiusSent(t *testing.T) []float64 {
	t.Helper()

	f.mu.Lock()
	defer f.mu.Unlock()

	var out []float64
	for _, message := range f.sent {
		var decoded struct {
			Payload struct {
				Celsius float64 `json:"celsius"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(message.Payload, &decoded); err != nil {
			t.Fatalf("published payload is not an envelope: %v", err)
		}
		out = append(out, decoded.Payload.Celsius)
	}
	return out
}

// countingSource returns 36.01, 36.02, ... so the order readings reach the
// broker is visible in the payloads.
type countingSource struct {
	n   int
	err error
}

func (s *countingSource) Read(context.Context) (sensor.Reading, error) {
	if s.err != nil {
		return sensor.Reading{}, s.err
	}
	s.n++
	battery := 90.0
	rssi := -61.0
	return sensor.Reading{
		Celsius:    36.0 + float64(s.n)/100,
		Timestamp:  time.Unix(1750000000+int64(s.n), 0).UTC(),
		BatteryPct: &battery,
		RSSIdBm:    &rssi,
	}, nil
}

type fixedSource struct{ reading sensor.Reading }

func (s fixedSource) Read(context.Context) (sensor.Reading, error) { return s.reading, nil }

func newTestCollector(source sensor.Source, publisher publisher, bufferSize int) *collector {
	return &collector{
		source:      source,
		publisher:   publisher,
		topic:       "v1/default/collector/AA:BB:CC:DD:EE:01/measurement/temperature",
		deviceID:    "AA:BB:CC:DD:EE:01",
		collectorID: "gateway-test",
		pending:     buffer.NewRing(bufferSize),
		stats:       &metrics.Counters{},
	}
}

// --- configuration -----------------------------------------------------------

func clearGatewayEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"GATEWAY_BROKER_URL", "GATEWAY_DEVICE_ID", "GATEWAY_TENANT", "GATEWAY_USER",
		"GATEWAY_COLLECTOR_ID", "GATEWAY_MQTT_USERNAME", "GATEWAY_MQTT_PASSWORD",
		"GATEWAY_BUFFER_SIZE", "GATEWAY_METRICS_ADDR",
	} {
		t.Setenv(key, "")
	}
}

func TestParseFlagsDefaults(t *testing.T) {
	clearGatewayEnv(t)

	cfg, err := parseFlags(nil)
	if err != nil {
		t.Fatalf("parseFlags() = %v", err)
	}

	if cfg.user != collectorTopicSegment {
		t.Errorf("--user default = %q, want %q (the only segment the broker's collector role allows)", cfg.user, collectorTopicSegment)
	}
	if cfg.mqttUsername != collectorTopicSegment {
		t.Errorf("--mqtt-username default = %q, want %q", cfg.mqttUsername, collectorTopicSegment)
	}
	if cfg.mqttPassword != "" {
		t.Errorf("--mqtt-password default = %q, want empty so an unconfigured gateway refuses to start", cfg.mqttPassword)
	}
	if cfg.allowAnonymous {
		t.Error("--allow-anonymous defaults to true, want false")
	}
	if cfg.bufferSize != defaultBufferSize {
		t.Errorf("--buffer-size default = %d, want %d", cfg.bufferSize, defaultBufferSize)
	}
	if cfg.metricsAddr != "" {
		t.Errorf("--metrics-addr default = %q, want empty (endpoint off)", cfg.metricsAddr)
	}
	if !cfg.simulate {
		t.Error("--simulate defaults to false, want true while the BlueZ source is unimplemented")
	}
}

func TestParseFlagsReadsEnvAndFlagsWin(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GATEWAY_MQTT_USERNAME", "collector")
	t.Setenv("GATEWAY_MQTT_PASSWORD", "from-env")
	t.Setenv("GATEWAY_BROKER_URL", "tcp://mosquitto:1883")
	t.Setenv("GATEWAY_BUFFER_SIZE", "8")

	cfg, err := parseFlags([]string{"--mqtt-password", "from-flag"})
	if err != nil {
		t.Fatalf("parseFlags() = %v", err)
	}
	if cfg.mqttPassword != "from-flag" {
		t.Errorf("mqttPassword = %q, want the flag to win over the env var", cfg.mqttPassword)
	}
	if cfg.brokerURL != "tcp://mosquitto:1883" {
		t.Errorf("brokerURL = %q, want the env var", cfg.brokerURL)
	}
	if cfg.bufferSize != 8 {
		t.Errorf("bufferSize = %d, want 8 from GATEWAY_BUFFER_SIZE", cfg.bufferSize)
	}
}

func TestParseFlagsIgnoresAnUnparseableBufferSize(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GATEWAY_BUFFER_SIZE", "many")

	cfg, err := parseFlags(nil)
	if err != nil {
		t.Fatalf("parseFlags() = %v", err)
	}
	if cfg.bufferSize != defaultBufferSize {
		t.Errorf("bufferSize = %d, want the %d default", cfg.bufferSize, defaultBufferSize)
	}
}

func validConfig() config {
	return config{
		brokerURL:    "tcp://localhost:1883",
		deviceID:     "AA:BB:CC:DD:EE:01",
		tenant:       "default",
		user:         collectorTopicSegment,
		collectorID:  "gateway-01",
		mqttUsername: collectorTopicSegment,
		mqttPassword: "collector-dev",
		interval:     5 * time.Second,
		mqttTimeout:  10 * time.Second,
		simulate:     true,
		bufferSize:   defaultBufferSize,
	}
}

func TestValidateAcceptsAFullyConfiguredGateway(t *testing.T) {
	if err := validConfig().validate(); err != nil {
		t.Fatalf("validate() = %v, want nil", err)
	}
}

// The broker no longer allows anonymous connections, so a gateway with no
// password is a misconfiguration that must fail loudly at startup (INF-04).
func TestValidateRefusesToStartWithoutAPassword(t *testing.T) {
	cfg := validConfig()
	cfg.mqttPassword = ""

	err := cfg.validate()
	if err == nil {
		t.Fatal("validate() accepted an empty password")
	}
	if !strings.Contains(err.Error(), "--mqtt-password") || !strings.Contains(err.Error(), "--allow-anonymous") {
		t.Errorf("validate() = %q, want it to name both the flag to set and the escape hatch", err)
	}
}

func TestValidateAllowsAnonymousOnlyWhenAskedExplicitly(t *testing.T) {
	cfg := validConfig()
	cfg.mqttPassword = ""
	cfg.mqttUsername = ""
	cfg.allowAnonymous = true

	if err := cfg.validate(); err != nil {
		t.Fatalf("validate() with --allow-anonymous = %v, want nil", err)
	}
}

func TestValidateRejectsBadValues(t *testing.T) {
	cases := map[string]func(*config){
		"empty broker url":   func(c *config) { c.brokerURL = "" },
		"empty username":     func(c *config) { c.mqttUsername = "" },
		"zero interval":      func(c *config) { c.interval = 0 },
		"negative interval":  func(c *config) { c.interval = -time.Second },
		"zero timeout":       func(c *config) { c.mqttTimeout = 0 },
		"zero buffer":        func(c *config) { c.bufferSize = 0 },
		"wildcard tenant":    func(c *config) { c.tenant = "+" },
		"slash in device id": func(c *config) { c.deviceID = "AA/BB" },
		"empty user segment": func(c *config) { c.user = "" },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig()
			mutate(&cfg)
			if err := cfg.validate(); err == nil {
				t.Errorf("validate() accepted %s", name)
			}
		})
	}
}

// --- meta (INF-20) -----------------------------------------------------------

func TestMetaForCarriesTheSchemaFields(t *testing.T) {
	battery := 87.5
	rssi := -61.0

	meta := metaFor(sensor.Reading{BatteryPct: &battery, RSSIdBm: &rssi})
	if meta["battery_pct"] != battery {
		t.Errorf("meta.battery_pct = %v, want %v", meta["battery_pct"], battery)
	}
	if meta["rssi_dbm"] != rssi {
		t.Errorf("meta.rssi_dbm = %v, want %v", meta["rssi_dbm"], rssi)
	}
}

func TestMetaForIsNilWhenTheSourceKnowsNothing(t *testing.T) {
	if meta := metaFor(sensor.Reading{Celsius: 36.9}); meta != nil {
		t.Errorf("metaFor() = %v, want nil so meta is omitted from the envelope", meta)
	}
}

func TestTickPopulatesMetaFromTheSource(t *testing.T) {
	publisher := &fakePublisher{}
	newTestCollector(&countingSource{}, publisher, 4).tick(context.Background())

	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	if len(publisher.sent) != 1 {
		t.Fatalf("published %d envelopes, want 1", len(publisher.sent))
	}

	var decoded struct {
		Meta map[string]float64 `json:"meta"`
	}
	if err := json.Unmarshal(publisher.sent[0].Payload, &decoded); err != nil {
		t.Fatalf("published payload is not an envelope: %v", err)
	}
	if decoded.Meta["battery_pct"] != 90 {
		t.Errorf("meta.battery_pct = %v, want the source's 90", decoded.Meta["battery_pct"])
	}
	if decoded.Meta["rssi_dbm"] != -61 {
		t.Errorf("meta.rssi_dbm = %v, want the source's -61", decoded.Meta["rssi_dbm"])
	}
}

// --- buffering / flushing (INF-11) -------------------------------------------

func TestReadingsAreBufferedDuringAnOutageAndReplayedInOrder(t *testing.T) {
	publisher := &fakePublisher{failing: true}
	collector := newTestCollector(&countingSource{}, publisher, 8)

	for i := 0; i < 3; i++ {
		collector.tick(context.Background())
	}
	if got := publisher.celsiusSent(t); len(got) != 0 {
		t.Fatalf("published %v during the outage, want nothing", got)
	}
	if collector.pending.Len() != 3 {
		t.Fatalf("buffered %d readings, want 3", collector.pending.Len())
	}
	if snapshot := collector.stats.Snapshot(); snapshot.Buffered != 3 || snapshot.PublishFailures != 3 || snapshot.Dropped != 0 {
		t.Errorf("counters = %s, want buffered=3 publish_failures=3 dropped=0", snapshot)
	}

	publisher.setFailing(false)
	collector.tick(context.Background())

	got := publisher.celsiusSent(t)
	want := []float64{36.01, 36.02, 36.03, 36.04}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("published %v, want the buffered readings first, in order: %v", got, want)
	}
	if collector.pending.Len() != 0 {
		t.Errorf("%d readings still buffered after a successful flush", collector.pending.Len())
	}
	if snapshot := collector.stats.Snapshot(); snapshot.Published != 4 {
		t.Errorf("counters = %s, want published=4", snapshot)
	}
}

func TestAFullBufferDropsTheOldestReadingsAndCountsThem(t *testing.T) {
	publisher := &fakePublisher{failing: true}
	collector := newTestCollector(&countingSource{}, publisher, 2)

	for i := 0; i < 5; i++ {
		collector.tick(context.Background())
	}
	if collector.pending.Len() != 2 {
		t.Fatalf("buffered %d readings, want the capacity 2", collector.pending.Len())
	}
	if snapshot := collector.stats.Snapshot(); snapshot.Dropped != 3 {
		t.Errorf("counters = %s, want dropped=3", snapshot)
	}

	publisher.setFailing(false)
	collector.tick(context.Background())

	got := publisher.celsiusSent(t)
	want := []float64{36.04, 36.05, 36.06}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("published %v, want the two newest buffered readings then the fresh one: %v", got, want)
	}
}

func TestAFailedFlushKeepsTheFreshReadingBuffered(t *testing.T) {
	publisher := &fakePublisher{failing: true}
	collector := newTestCollector(&countingSource{}, publisher, 8)

	collector.tick(context.Background()) // buffers reading 1
	collector.tick(context.Background()) // flush fails, buffers reading 2

	if collector.pending.Len() != 2 {
		t.Fatalf("buffered %d readings, want 2", collector.pending.Len())
	}
	// One publish attempt per tick: the second tick must not try the fresh
	// reading after the replay failed, or the broker would see them out of
	// order once it recovers.
	if snapshot := collector.stats.Snapshot(); snapshot.PublishFailures != 2 {
		t.Errorf("counters = %s, want exactly one failed attempt per tick", snapshot)
	}
}

func TestASensorFailureIsCountedAndNothingIsPublished(t *testing.T) {
	publisher := &fakePublisher{}
	collector := newTestCollector(&countingSource{err: errors.New("no device")}, publisher, 4)

	collector.tick(context.Background())

	if got := publisher.celsiusSent(t); len(got) != 0 {
		t.Errorf("published %v after a sensor failure, want nothing", got)
	}
	if snapshot := collector.stats.Snapshot(); snapshot.SensorFailures != 1 || snapshot.Buffered != 0 {
		t.Errorf("counters = %s, want sensor_failures=1 and nothing buffered", snapshot)
	}
}

func TestAReadingTheSchemaWouldRejectIsDiscarded(t *testing.T) {
	publisher := &fakePublisher{}
	source := fixedSource{reading: sensor.Reading{Celsius: -500, Timestamp: time.Now()}}
	collector := newTestCollector(source, publisher, 4)

	collector.tick(context.Background())

	if got := publisher.celsiusSent(t); len(got) != 0 {
		t.Errorf("published %v, want an implausible reading to be dropped", got)
	}
	if snapshot := collector.stats.Snapshot(); snapshot.SensorFailures != 1 {
		t.Errorf("counters = %s, want sensor_failures=1", snapshot)
	}
}

// --- the whole loop ----------------------------------------------------------

// startTestBroker runs an embedded mochi-mqtt broker that requires the
// `collector` credentials, mirroring the dynamic-security Mosquitto the gateway
// talks to in compose.
func startTestBroker(t *testing.T) (brokerURL string, messages <-chan string) {
	t.Helper()

	server := mochi.New(&mochi.Options{
		InlineClient: true,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	ledger := &mochiauth.Ledger{
		Auth: mochiauth.AuthRules{{Username: "collector", Password: "collector-dev", Allow: true}},
		ACL:  mochiauth.ACLRules{{Filters: mochiauth.Filters{"#": mochiauth.ReadWrite}}},
	}
	if err := server.AddHook(new(mochiauth.Hook), &mochiauth.Options{Ledger: ledger}); err != nil {
		t.Fatalf("adding the auth hook: %v", err)
	}
	listener := listeners.NewTCP(listeners.Config{ID: "test-tcp", Address: "127.0.0.1:0"})
	if err := server.AddListener(listener); err != nil {
		t.Fatalf("binding the embedded broker: %v", err)
	}

	received := make(chan string, 16)
	if err := server.Subscribe("v1/#", 1, func(_ *mochi.Client, _ packets.Subscription, pk packets.Packet) {
		received <- pk.TopicName
	}); err != nil {
		t.Fatalf("subscribing the inline client: %v", err)
	}
	go func() { _ = server.Serve() }()
	t.Cleanup(func() { _ = server.Close() })

	return "tcp://" + listener.Address(), received
}

func freePort(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("closing: %v", err)
	}
	return addr
}

// TestRunPublishesAndServesMetrics exercises the real loop end to end: real
// credentials against a real broker, the simulator's meta, the /metrics
// endpoint, and a clean return on SIGTERM's context cancellation.
func TestRunPublishesAndServesMetrics(t *testing.T) {
	brokerURL, messages := startTestBroker(t)
	metricsAddr := freePort(t)

	cfg := validConfig()
	cfg.brokerURL = brokerURL
	cfg.interval = 20 * time.Millisecond
	cfg.mqttTimeout = 2 * time.Second
	cfg.metricsAddr = metricsAddr

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg) }()

	select {
	case topic := <-messages:
		if topic != "v1/default/collector/AA:BB:CC:DD:EE:01/measurement/temperature" {
			t.Errorf("published to %q, want the collector topic", topic)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the broker never received a reading")
	}

	body := scrape(t, metricsAddr)
	if !strings.Contains(body, "gateway_published_total") || strings.Contains(body, "gateway_published_total 0") {
		t.Errorf("/metrics does not show a successful publish:\n%s", body)
	}
	if !strings.Contains(body, fmt.Sprintf("gateway_buffer_capacity %d", defaultBufferSize)) {
		t.Errorf("/metrics does not report the buffer capacity:\n%s", body)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("run() = %v, want a clean shutdown", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run() did not return after its context was cancelled")
	}
}

// TestRunShutsDownWhileTheBrokerIsStalled is INF-05's regression test at the
// loop level: the broker answers the CONNECT and then nothing, so every
// publish is stuck in a bounded wait — SIGTERM must still end the process.
func TestRunShutsDownWhileTheBrokerIsStalled(t *testing.T) {
	brokerURL := startStalledBroker(t)

	cfg := validConfig()
	cfg.brokerURL = brokerURL
	cfg.interval = 20 * time.Millisecond
	cfg.mqttTimeout = 30 * time.Second // only the context can unblock a publish
	cfg.bufferSize = 4

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg) }()

	time.Sleep(200 * time.Millisecond) // let the loop get stuck in a publish
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Errorf("run() = %v, want a clean shutdown", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run() hung on a broker that never acknowledges a publish")
	}
}

// startStalledBroker accepts connections, answers the CONNECT so the client
// believes it is connected, and then never responds again.
func startStalledBroker(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	done := make(chan struct{})

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				if _, err := io.ReadFull(conn, make([]byte, 1)); err != nil {
					return
				}
				_ = conn.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
				_, _ = conn.Read(make([]byte, 1024))
				_ = conn.SetReadDeadline(time.Time{})
				if _, err := conn.Write([]byte{0x20, 0x02, 0x00, 0x00}); err != nil { // CONNACK, accepted
					return
				}
				<-done
			}()
		}
	}()
	t.Cleanup(func() {
		close(done)
		_ = listener.Close()
	})

	return "tcp://" + listener.Addr().String()
}

func scrape(t *testing.T, addr string) string {
	t.Helper()

	var lastErr error
	for attempt := 0; attempt < 50; attempt++ {
		response, err := http.Get("http://" + addr + "/metrics") //nolint:noctx // short-lived test scrape
		if err != nil {
			lastErr = err
			time.Sleep(100 * time.Millisecond)
			continue
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("reading /metrics: %v", err)
		}
		return string(body)
	}
	t.Fatalf("GET /metrics never succeeded: %v", lastErr)
	return ""
}
