package sensor

import "testing"

func TestSimulatorProducesPlausibleTemperatures(t *testing.T) {
	sim := NewSimulator(42)

	for i := 0; i < 100; i++ {
		reading, err := sim.Read()
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

	readingA, err := simA.Read()
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}
	readingB, err := simB.Read()
	if err != nil {
		t.Fatalf("Read() returned an error: %v", err)
	}

	if readingA.Celsius != readingB.Celsius {
		t.Errorf("same seed produced different readings: %.4f vs %.4f", readingA.Celsius, readingB.Celsius)
	}
}
