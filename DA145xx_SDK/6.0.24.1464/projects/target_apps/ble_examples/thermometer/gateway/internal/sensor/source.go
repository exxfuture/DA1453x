// Package sensor abstracts where a temperature reading comes from, so the
// gateway's main loop doesn't care whether it's talking to a real device or
// a simulator.
package sensor

import (
	"context"
	"time"
)

// Reading is one measurement plus whatever collector-side context the source
// happens to know. BatteryPct and RSSIdBm are optional: they map onto the
// shared envelope's meta.battery_pct / meta.rssi_dbm (see
// ../../../schema/measurement-envelope.v1.schema.json) and are nil for a
// source that cannot observe them, in which case meta is omitted entirely
// rather than sent as nulls.
type Reading struct {
	Celsius    float64
	Timestamp  time.Time
	BatteryPct *float64
	RSSIdBm    *float64
}

// Source is implemented by Simulator here, and (not yet) by a real BlueZ
// HTP subscription — see bluez.go.
//
// Read takes a context because a real implementation waits on hardware (a
// BlueZ scan, a GATT indication): the gateway must be able to abandon that
// wait when it is shutting down (INF-05).
type Source interface {
	Read(ctx context.Context) (Reading, error)
}
