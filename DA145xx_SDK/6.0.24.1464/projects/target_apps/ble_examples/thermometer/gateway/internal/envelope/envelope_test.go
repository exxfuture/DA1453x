package envelope

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNewTemperatureMarshalsToTheSharedWireSchema(t *testing.T) {
	ts := time.Date(2026, 7, 26, 12, 34, 56, 0, time.UTC)
	env := NewTemperature("48:23:35:F4:00:10", "gw-01", ts, 27.15, map[string]interface{}{
		"battery_pct": 87,
	})

	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	wantFields := []string{"v", "device_id", "collector_id", "ts", "type", "payload", "meta"}
	for _, field := range wantFields {
		if _, ok := decoded[field]; !ok {
			t.Errorf("expected field %q in marshaled envelope, got: %s", field, raw)
		}
	}

	if decoded["device_id"] != "48:23:35:F4:00:10" {
		t.Errorf("device_id = %v, want the BD address", decoded["device_id"])
	}
	if decoded["type"] != "temperature" {
		t.Errorf("type = %v, want temperature", decoded["type"])
	}

	payload, ok := decoded["payload"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload is not an object: %v", decoded["payload"])
	}
	if payload["celsius"] != 27.15 {
		t.Errorf("payload.celsius = %v, want 27.15", payload["celsius"])
	}
}

func TestNewTemperatureOmitsMetaWhenNil(t *testing.T) {
	env := NewTemperature("AA:BB:CC:DD:EE:FF", "gw-01", time.Now(), 20.0, nil)

	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if _, present := decoded["meta"]; present {
		t.Errorf("expected meta to be omitted when nil, got: %s", raw)
	}
}

func TestTopicMatchesTheSharedNamingScheme(t *testing.T) {
	got := Topic("tenant1", "user1", "AA:BB:CC:DD:EE:FF", "temperature")
	want := "v1/tenant1/user1/AA:BB:CC:DD:EE:FF/measurement/temperature"
	if got != want {
		t.Errorf("Topic() = %q, want %q", got, want)
	}
}
