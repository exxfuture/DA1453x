package envelope

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func TestNewTemperatureMarshalsToTheSharedWireSchema(t *testing.T) {
	ts := time.Date(2026, 7, 26, 12, 34, 56, 0, time.UTC)
	env, err := NewTemperature("48:23:35:F4:00:10", "gw-01", ts, 27.15, map[string]interface{}{
		"battery_pct": 87,
	})
	if err != nil {
		t.Fatalf("NewTemperature returned an error: %v", err)
	}

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
	if decoded["ts"] != "2026-07-26T12:34:56Z" {
		t.Errorf("ts = %v, want an RFC 3339 UTC timestamp", decoded["ts"])
	}

	payload, ok := decoded["payload"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload is not an object: %v", decoded["payload"])
	}
	if payload["celsius"] != 27.15 {
		t.Errorf("payload.celsius = %v, want 27.15", payload["celsius"])
	}
}

func TestNewTemperatureNormalisesTheTimestampToUTC(t *testing.T) {
	zone := time.FixedZone("UTC+2", 2*60*60)
	env, err := NewTemperature("AA:BB:CC:DD:EE:FF", "gw-01", time.Date(2026, 7, 26, 14, 34, 56, 0, zone), 36.9, nil)
	if err != nil {
		t.Fatalf("NewTemperature returned an error: %v", err)
	}
	if got := env.Timestamp.Format(time.RFC3339); got != "2026-07-26T12:34:56Z" {
		t.Errorf("ts = %s, want the same instant in UTC", got)
	}
}

func TestNewTemperatureOmitsMetaWhenNil(t *testing.T) {
	env, err := NewTemperature("AA:BB:CC:DD:EE:FF", "gw-01", time.Now(), 20.0, nil)
	if err != nil {
		t.Fatalf("NewTemperature returned an error: %v", err)
	}

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

func TestNewTemperatureRejectsUnusableReadings(t *testing.T) {
	ts := time.Date(2026, 7, 26, 12, 34, 56, 0, time.UTC)
	cases := []struct {
		name        string
		deviceID    string
		collectorID string
		ts          time.Time
		celsius     float64
	}{
		{"NaN", "AA:BB:CC:DD:EE:FF", "gw-01", ts, math.NaN()},
		{"positive infinity", "AA:BB:CC:DD:EE:FF", "gw-01", ts, math.Inf(1)},
		{"negative infinity", "AA:BB:CC:DD:EE:FF", "gw-01", ts, math.Inf(-1)},
		{"below absolute zero", "AA:BB:CC:DD:EE:FF", "gw-01", ts, -300},
		{"absurdly hot", "AA:BB:CC:DD:EE:FF", "gw-01", ts, 5000},
		{"empty device id", "", "gw-01", ts, 36.9},
		{"wildcard in device id", "AA:BB:#", "gw-01", ts, 36.9},
		{"separator in device id", "AA/BB", "gw-01", ts, 36.9},
		{"device id too long", "AA:BB:CC:DD:EE:FF:00", "gw-01", ts, 36.9},
		{"empty collector id", "AA:BB:CC:DD:EE:FF", "", ts, 36.9},
		{"oversized collector id", "AA:BB:CC:DD:EE:FF", strings.Repeat("g", 129), ts, 36.9},
		{"zero timestamp", "AA:BB:CC:DD:EE:FF", "gw-01", time.Time{}, 36.9},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewTemperature(tc.deviceID, tc.collectorID, tc.ts, tc.celsius, nil); err == nil {
				t.Fatalf("NewTemperature accepted %s", tc.name)
			}
		})
	}
}

func TestTopicMatchesTheSharedNamingScheme(t *testing.T) {
	got, err := Topic("tenant1", "collector", "AA:BB:CC:DD:EE:FF", "temperature")
	if err != nil {
		t.Fatalf("Topic returned an error: %v", err)
	}
	want := "v1/tenant1/collector/AA:BB:CC:DD:EE:FF/measurement/temperature"
	if got != want {
		t.Errorf("Topic() = %q, want %q", got, want)
	}
}

func TestTopicRejectsWildcardsAndSeparators(t *testing.T) {
	cases := []struct {
		name                                    string
		tenant, user, deviceID, measurementType string
	}{
		{"single-level wildcard in tenant", "+", "collector", "AA:BB", "temperature"},
		{"multi-level wildcard in user", "default", "#", "AA:BB", "temperature"},
		{"separator in user", "default", "a/b", "AA:BB", "temperature"},
		{"separator in device id", "default", "collector", "AA/BB", "temperature"},
		{"wildcard in measurement type", "default", "collector", "AA:BB", "temp+"},
		{"NUL in tenant", "def\x00ault", "collector", "AA:BB", "temperature"},
		{"space in tenant", "def ault", "collector", "AA:BB", "temperature"},
		{"tab in user", "default", "coll\tector", "AA:BB", "temperature"},
		{"newline in device id", "default", "collector", "AA:BB\n", "temperature"},
		{"empty tenant", "", "collector", "AA:BB", "temperature"},
		{"empty measurement type", "default", "collector", "AA:BB", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			topic, err := Topic(tc.tenant, tc.user, tc.deviceID, tc.measurementType)
			if err == nil {
				t.Fatalf("Topic accepted %s, produced %q", tc.name, topic)
			}
			if topic != "" {
				t.Errorf("Topic returned %q alongside an error, want the empty string", topic)
			}
		})
	}
}

func TestValidateSegmentAcceptsTheValuesTheGatewayUses(t *testing.T) {
	for _, value := range []string{"default", "collector", "gateway-01", "AA:BB:CC:DD:EE:01", "temperature", "fw_1.2.3"} {
		if err := ValidateSegment("segment", value); err != nil {
			t.Errorf("ValidateSegment(%q) = %v, want nil", value, err)
		}
	}
}
