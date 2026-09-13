// Package envelope defines the one wire format shared by every collector —
// mobile app, web app, and this gateway — and every measurement type
// (architecture v2 §6.2 / v3 §7). New measurement types add a payload shape,
// never a new envelope.
package envelope

import "time"

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

// Topic builds the MQTT topic a measurement of this envelope is published to.
func Topic(tenant, user, deviceID, measurementType string) string {
	return "v1/" + tenant + "/" + user + "/" + deviceID + "/measurement/" + measurementType
}

// NewTemperature builds the envelope for a single temperature reading.
func NewTemperature(deviceID, collectorID string, ts time.Time, celsius float64, meta map[string]interface{}) Envelope {
	return Envelope{
		V:           1,
		DeviceID:    deviceID,
		CollectorID: collectorID,
		Timestamp:   ts,
		Type:        "temperature",
		Payload:     map[string]interface{}{"celsius": celsius},
		Meta:        meta,
	}
}
