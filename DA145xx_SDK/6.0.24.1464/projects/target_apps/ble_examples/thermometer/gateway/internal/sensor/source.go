// Package sensor abstracts where a temperature reading comes from, so the
// gateway's main loop doesn't care whether it's talking to a real device or
// a simulator.
package sensor

import "time"

type Reading struct {
	Celsius   float64
	Timestamp time.Time
}

// Source is implemented by Simulator here, and (not yet) by a real BlueZ
// HTP subscription — see bluez.go.
type Source interface {
	Read() (Reading, error)
}
