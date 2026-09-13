package sensor

import (
	"math"
	"math/rand"
	"time"
)

// Simulator generates plausible readings without real hardware, so the
// whole ingest pipeline (gateway -> broker -> backend -> API) is testable
// locally without a physical DA14535 board.
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

func (s *Simulator) Read() (Reading, error) {
	elapsedMinutes := time.Since(s.start).Minutes()
	drift := 0.3 * math.Sin(elapsedMinutes/10.0) // slow wander over ~an hour
	noise := (s.rng.Float64() - 0.5) * 0.1       // +/- 0.05 °C sensor noise
	celsius := math.Round((s.baseline+drift+noise)*100) / 100

	return Reading{Celsius: celsius, Timestamp: time.Now()}, nil
}
