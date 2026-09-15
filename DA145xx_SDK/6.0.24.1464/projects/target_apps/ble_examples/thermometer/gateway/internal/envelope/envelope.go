// Package envelope defines the one wire format shared by every collector —
// mobile app, web app, and this gateway — and every measurement type
// (architecture v2 §6.2 / v3 §7). New measurement types add a payload shape,
// never a new envelope.
//
// The authoritative definition of the format is the JSON Schema at
// ../../../schema/measurement-envelope.v1.schema.json; schema_test.go
// validates what this package produces against that file, so the Go, Java and
// TypeScript encoders cannot drift apart silently (INF-07). Change the schema
// first, then this package.
//
// Both constructors validate their inputs (INF-16): a topic segment may not
// smuggle MQTT wildcards or separators, and a non-finite temperature never
// reaches the broker.
package envelope

import (
	"errors"
	"fmt"
	"math"
	"time"
)

const (
	// Version is the only envelope version that exists.
	Version = 1

	// maxDeviceIDLen mirrors the schema's device_id maxLength (devices.bd_addr
	// is VARCHAR(17)).
	maxDeviceIDLen = 17
	// maxCollectorIDLen mirrors the schema's collector_id maxLength
	// (measurements.collector_id is VARCHAR(128)).
	maxCollectorIDLen = 128
	// maxSegmentLen keeps a topic segment to something a broker and the
	// backend's parser will accept comfortably.
	maxSegmentLen = 128

	// minCelsius / maxCelsius mirror the schema's bounds for a temperature
	// payload. A reading outside them is a broken sensor, not a measurement.
	minCelsius = -273.15
	maxCelsius = 1000.0
)

// Envelope is the JSON structure published to
// v1/{tenant}/{user}/{deviceId}/measurement/{type}.
type Envelope struct {
	V           int                    `json:"v"`
	DeviceID    string                 `json:"device_id"`
	CollectorID string                 `json:"collector_id"`
	Timestamp   time.Time              `json:"ts"`
	Type        string                 `json:"type"`
	Payload     map[string]interface{} `json:"payload"`
	Meta        map[string]interface{} `json:"meta,omitempty"`
}

// Topic builds the MQTT topic a measurement of this envelope is published to,
// rejecting any segment that is empty or contains a character which would
// change the topic's meaning (see ValidateSegment).
func Topic(tenant, user, deviceID, measurementType string) (string, error) {
	segments := []struct {
		name  string
		value string
	}{
		{"tenant", tenant},
		{"user", user},
		{"device id", deviceID},
		{"measurement type", measurementType},
	}
	for _, segment := range segments {
		if err := ValidateSegment(segment.name, segment.value); err != nil {
			return "", err
		}
	}
	return "v1/" + tenant + "/" + user + "/" + deviceID + "/measurement/" + measurementType, nil
}

// ValidateSegment checks that value is usable as a single MQTT topic segment.
// The allowed set is a strict allowlist — ASCII letters, digits and `-_.:`
// (`:` because a BD address is written AA:BB:CC:DD:EE:FF) — which by
// construction excludes the level separator `/`, both wildcards `+` and `#`,
// NUL and every kind of whitespace. name is used in the error message only.
func ValidateSegment(name, value string) error {
	if value == "" {
		return fmt.Errorf("%s must not be empty", name)
	}
	if len(value) > maxSegmentLen {
		return fmt.Errorf("%s is %d bytes, longer than the %d-byte limit", name, len(value), maxSegmentLen)
	}
	for _, r := range value {
		if !segmentRuneAllowed(r) {
			return fmt.Errorf("%s %q contains the disallowed character %q (allowed: letters, digits, '-', '_', '.' and ':')", name, value, r)
		}
	}
	return nil
}

func segmentRuneAllowed(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return true
	case r == '-', r == '_', r == '.', r == ':':
		return true
	default:
		return false
	}
}

// NewTemperature builds the envelope for a single temperature reading. It
// returns an error rather than a half-valid envelope when an input could not
// produce a schema-valid document: a non-finite or physically impossible
// temperature, an unusable device id, an empty/oversized collector id or a
// zero timestamp. The timestamp is normalised to UTC so `ts` always carries
// the schema's preferred 'Z' offset.
func NewTemperature(deviceID, collectorID string, ts time.Time, celsius float64, meta map[string]interface{}) (Envelope, error) {
	if err := ValidateSegment("device id", deviceID); err != nil {
		return Envelope{}, err
	}
	if len(deviceID) > maxDeviceIDLen {
		return Envelope{}, fmt.Errorf("device id %q is %d bytes, longer than the %d-byte limit", deviceID, len(deviceID), maxDeviceIDLen)
	}
	if collectorID == "" {
		return Envelope{}, errors.New("collector id must not be empty")
	}
	if len(collectorID) > maxCollectorIDLen {
		return Envelope{}, fmt.Errorf("collector id is %d bytes, longer than the %d-byte limit", len(collectorID), maxCollectorIDLen)
	}
	if ts.IsZero() {
		return Envelope{}, errors.New("timestamp must be set")
	}
	if math.IsNaN(celsius) || math.IsInf(celsius, 0) {
		return Envelope{}, fmt.Errorf("temperature is not a finite number (%v)", celsius)
	}
	if celsius < minCelsius || celsius > maxCelsius {
		return Envelope{}, fmt.Errorf("temperature %.2f°C is outside the plausible range [%.2f, %.2f]", celsius, minCelsius, maxCelsius)
	}

	return Envelope{
		V:           Version,
		DeviceID:    deviceID,
		CollectorID: collectorID,
		Timestamp:   ts.UTC(),
		Type:        "temperature",
		Payload:     map[string]interface{}{"celsius": celsius},
		Meta:        meta,
	}, nil
}
