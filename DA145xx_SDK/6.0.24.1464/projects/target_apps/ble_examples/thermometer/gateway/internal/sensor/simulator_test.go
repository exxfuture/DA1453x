package sensor

import (
	"context"
	"testing"
	"time"
)

func TestSimulatorProducesPlausibleTemperatures(t *testing.T) {
	sim := NewSimulator(42)

	for i := 0; i < 100; i++ {
		reading, err := sim.Read(context.Background())
		if err != nil {
			t.Fatalf("Read() returned an error: %v", err)
		}
		if reading.Celsius < 35.0 || reading.Celsius > 39.0 {
			t.Errorf("reading %d out of plausible range: %.2f°C", i, reading.Celsius)
		}
		if reading.Timestamp.IsZero() {
			t.Errorf("reading %d has a zero timestamp", i)
		}
	}
}

func TestSimulatorIsDeterministicForAGivenSeed(t *testing.T) {
	simA := NewSimulator(7)
	simB := NewSimulator(7)

	readingA, err := simA.Read(context.Background())
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}
	readingB, err := simB.Read(context.Background())
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}

	if readingA.Celsius != readingB.Celsius {
		t.Errorf("same seed produced different readings: %.4f vs %.4f", readingA.Celsius, readingB.Celsius)
	}
}

// The envelope's meta must actually be populated (INF-20), within the bounds
// the shared schema allows for meta.battery_pct / meta.rssi_dbm.
func TestSimulatorReportsBatteryAndRSSIMeta(t *testing.T) {
	sim := NewSimulator(42)

	reading, err := sim.Read(context.Background())
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}
	if reading.BatteryPct == nil {
		t.Fatal("BatteryPct is nil, want a simulated battery level")
	}
	if *reading.BatteryPct < 0 || *reading.BatteryPct > 100 {
		t.Errorf("BatteryPct = %.1f, want the schema's 0..100 range", *reading.BatteryPct)
	}
	if reading.RSSIdBm == nil {
		t.Fatal("RSSIdBm is nil, want a simulated link quality")
	}
	if *reading.RSSIdBm > 0 || *reading.RSSIdBm < -110 {
		t.Errorf("RSSIdBm = %.0f, want a plausible negative dBm value", *reading.RSSIdBm)
	}
}

func TestSimulatorBatteryDrainsSlowlyAndNeverBelowTheFloor(t *testing.T) {
	sim := NewSimulator(1)

	fresh, err := sim.Read(context.Background())
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}
	if *fresh.BatteryPct != batteryStartPct {
		t.Errorf("battery at startup = %.1f, want %.1f", *fresh.BatteryPct, batteryStartPct)
	}

	sim.start = time.Now().Add(-10 * time.Hour)
	drained, err := sim.Read(context.Background())
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}
	if want := batteryStartPct - 10*batteryDrainPctPerHour; *drained.BatteryPct != want {
		t.Errorf("battery after 10h = %.1f, want %.1f", *drained.BatteryPct, want)
	}

	sim.start = time.Now().Add(-10000 * time.Hour)
	empty, err := sim.Read(context.Background())
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}
	if *empty.BatteryPct != batteryFloorPct {
		t.Errorf("battery after a very long run = %.1f, want the floor %.1f", *empty.BatteryPct, batteryFloorPct)
	}
}

func TestSimulatorHonoursACancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := NewSimulator(3).Read(ctx); err == nil {
		t.Error("Read() with a cancelled context returned no error")
	}
}

func TestBlueZSourceIsNotImplementedYet(t *testing.T) {
	source, err := NewBlueZSource("AA:BB:CC:DD:EE:01")
	if err == nil {
		t.Fatal("NewBlueZSource returned no error, but the BlueZ path is not implemented")
	}
	if source != nil {
		t.Error("NewBlueZSource returned a Source alongside an error")
	}
}
