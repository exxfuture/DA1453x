package sensor

import (
	"context"
	"math"
	"math/rand"
	"time"
)

const (
	// batteryStartPct / batteryDrainPctPerHour model a CR2032-powered wearable
	// that lasts a couple of days between charges — slow enough that a local
	// demo session shows a stable value, fast enough that a long-running
	// gateway exercises the battery column downstream.
	batteryStartPct        = 100.0
	batteryDrainPctPerHour = 2.0
	batteryFloorPct        = 1.0

	// rssiBaselineDBm / rssiSwingDBm are a plausible "device on the desk next
	// to the SBC" link budget.
	rssiBaselineDBm = -58.0
	rssiSwingDBm    = 12.0
)

// Simulator generates plausible readings without real hardware, so the
// whole ingest pipeline (gateway -> broker -> backend -> API) is testable
// locally without a physical DA14535 board. It also synthesises the meta
// fields a real collector reports (battery percentage, RSSI), so the
// envelope's meta is exercised end to end rather than always being empty
// (INF-20) — the BlueZ source will replace these with values read from the
// device's Battery Service and the BlueZ adapter.
type Simulator struct {
	baseline float64
	rng      *rand.Rand
	start    time.Time
}

func NewSimulator(seed int64) *Simulator {
	return &Simulator{
		baseline: 36.8,
		rng:      rand.New(rand.NewSource(seed)),
		start:    time.Now(),
	}
}

// Read never blocks, so it ignores the context beyond honouring an already
// cancelled one — the real BlueZ source is where the context earns its keep.
func (s *Simulator) Read(ctx context.Context) (Reading, error) {
	if err := ctx.Err(); err != nil {
		return Reading{}, err
	}

	elapsed := time.Since(s.start)
	drift := 0.3 * math.Sin(elapsed.Minutes()/10.0) // slow wander over ~an hour
	noise := (s.rng.Float64() - 0.5) * 0.1          // +/- 0.05 °C sensor noise
	celsius := math.Round((s.baseline+drift+noise)*100) / 100

	battery := math.Max(batteryFloorPct, batteryStartPct-elapsed.Hours()*batteryDrainPctPerHour)
	battery = math.Round(battery*10) / 10
	rssi := math.Round(rssiBaselineDBm + (s.rng.Float64()-0.5)*rssiSwingDBm)

	return Reading{
		Celsius:    celsius,
		Timestamp:  time.Now(),
		BatteryPct: &battery,
		RSSIdBm:    &rssi,
	}, nil
}
