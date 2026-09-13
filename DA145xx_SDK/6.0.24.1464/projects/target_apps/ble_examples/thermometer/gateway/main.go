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
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"thermometer-gateway/internal/envelope"
	"thermometer-gateway/internal/mqtt"
	"thermometer-gateway/internal/sensor"
)

func main() {
	brokerURL := flag.String("broker-url", envOr("GATEWAY_BROKER_URL", "tcp://localhost:1883"), "MQTT broker URL")
	deviceID := flag.String("device-id", envOr("GATEWAY_DEVICE_ID", "AA:BB:CC:DD:EE:01"), "BD address of the device")
	tenant := flag.String("tenant", envOr("GATEWAY_TENANT", "default"), "tenant segment of the MQTT topic")
	user := flag.String("user", envOr("GATEWAY_USER", "local-dev-user"), "user segment of the MQTT topic")
	collectorID := flag.String("collector-id", envOr("GATEWAY_COLLECTOR_ID", "gateway-01"), "collector_id reported in the envelope")
	interval := flag.Duration("interval", 5*time.Second, "measurement interval")
	simulate := flag.Bool("simulate", true, "generate synthetic readings instead of a real BlueZ scan (BlueZ path not implemented — see internal/sensor/bluez.go)")
	flag.Parse()

	source, err := buildSource(*simulate, *deviceID)
	if err != nil {
		log.Fatalf("sensor source unavailable: %v", err)
	}

	publisher, err := mqtt.Connect(mqtt.Options{
		BrokerURL: *brokerURL,
		ClientID:  "gateway-" + *deviceID,
	})
	if err != nil {
		log.Fatalf("mqtt connect failed: %v", err)
	}
	defer publisher.Disconnect()

	topic := envelope.Topic(*tenant, *user, *deviceID, "temperature")
	log.Printf("publishing to %s every %s (simulate=%v)", topic, *interval, *simulate)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("shutting down")
			return
		case <-ticker.C:
			publishOnce(source, publisher, topic, *deviceID, *collectorID)
		}
	}
}

func buildSource(simulate bool, deviceID string) (sensor.Source, error) {
	if simulate {
		return sensor.NewSimulator(time.Now().UnixNano()), nil
	}
	return sensor.NewBlueZSource(deviceID)
}

func publishOnce(source sensor.Source, publisher *mqtt.Publisher, topic, deviceID, collectorID string) {
	reading, err := source.Read()
	if err != nil {
		log.Printf("sensor read failed: %v", err)
		return
	}

	env := envelope.NewTemperature(deviceID, collectorID, reading.Timestamp, reading.Celsius, nil)
	payload, err := json.Marshal(env)
	if err != nil {
		log.Printf("envelope marshal failed: %v", err)
		return
	}

	if err := publisher.Publish(topic, payload); err != nil {
		log.Printf("publish failed: %v", err)
		return
	}
	log.Printf("published %.2f°C to %s", reading.Celsius, topic)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
