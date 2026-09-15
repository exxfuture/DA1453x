package envelope

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// schemaPath is the shared single source of truth for the wire format
// (INF-07), read from disk rather than copied: if the schema changes and this
// encoder does not, these tests fail. The Java backend and the TypeScript
// frontend validate against the very same file.
const schemaPath = "../../../schema/measurement-envelope.v1.schema.json"

func compileSharedSchema(t *testing.T) *jsonschema.Schema {
	t.Helper()

	abs, err := filepath.Abs(schemaPath)
	if err != nil {
		t.Fatalf("resolving %s: %v", schemaPath, err)
	}
	file, err := os.Open(abs)
	if err != nil {
		t.Fatalf("the shared measurement envelope schema must exist at %s: %v", abs, err)
	}
	defer file.Close()

	doc, err := jsonschema.UnmarshalJSON(file)
	if err != nil {
		t.Fatalf("%s is not valid JSON: %v", abs, err)
	}

	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat() // so `ts` is checked against format: date-time too
	const resource = "measurement-envelope.v1.schema.json"
	if err := compiler.AddResource(resource, doc); err != nil {
		t.Fatalf("adding %s to the compiler: %v", abs, err)
	}
	schema, err := compiler.Compile(resource)
	if err != nil {
		t.Fatalf("compiling %s: %v", abs, err)
	}
	return schema
}

// asJSONDocument marshals the envelope and decodes it back the way a schema
// validator needs it (numbers as json.Number), i.e. it validates exactly the
// bytes that would go on the wire.
func asJSONDocument(t *testing.T, env Envelope) any {
	t.Helper()

	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("marshalled envelope is not valid JSON: %v", err)
	}
	return doc
}

func TestNewTemperatureSatisfiesTheSharedSchema(t *testing.T) {
	schema := compileSharedSchema(t)
	ts := time.Date(2026, 7, 26, 12, 34, 56, 123000000, time.UTC)

	cases := []struct {
		name string
		meta map[string]interface{}
	}{
		{"without meta", nil},
		{
			"with meta",
			map[string]interface{}{
				"battery_pct": 87.5,
				"rssi_dbm":    -61,
				"fw_version":  "1.0.0",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env, err := NewTemperature("48:23:35:F4:00:10", "gateway-01", ts, 36.92, tc.meta)
			if err != nil {
				t.Fatalf("NewTemperature returned an error: %v", err)
			}
			if err := schema.Validate(asJSONDocument(t, env)); err != nil {
				t.Fatalf("envelope does not satisfy %s: %v", schemaPath, err)
			}
		})
	}
}

// TestTheSchemaRejectsWhatTheConstructorRejects pins the two validations
// together: the values NewTemperature refuses (INF-16) are exactly values the
// shared schema would refuse as well, so the Go-side guard is not stricter or
// looser than the contract for the cases the review called out.
func TestTheSchemaRejectsWhatTheConstructorRejects(t *testing.T) {
	schema := compileSharedSchema(t)
	ts := time.Date(2026, 7, 26, 12, 34, 56, 0, time.UTC)

	if _, err := NewTemperature("48:23:35:F4:00:10", "gateway-01", ts, math.NaN(), nil); err == nil {
		t.Fatal("NewTemperature accepted NaN")
	}
	// A NaN cannot even be marshalled to JSON, so the only way it could reach
	// the broker is as the string "NaN" — which the schema rejects because
	// payload.celsius must be a number.
	handRolled := map[string]any{
		"v": 1, "device_id": "48:23:35:F4:00:10", "collector_id": "gateway-01",
		"ts": "2026-07-26T12:34:56Z", "type": "temperature",
		"payload": map[string]any{"celsius": "NaN"},
	}
	if err := schema.Validate(mustRoundTrip(t, handRolled)); err == nil {
		t.Error("the shared schema accepted a non-numeric celsius")
	}

	// The wildcard topic segment case from INF-16: the segment ends up in
	// device_id, and the schema's own device_id bound (17 chars) plus
	// ValidateSegment both refuse it.
	if _, err := Topic("default", "collector", "AA:BB:CC:DD:EE:FF/+", "temperature"); err == nil {
		t.Error("Topic accepted a wildcard device id")
	}
	if _, err := NewTemperature("AA:BB:CC:DD:EE:FF/+", "gateway-01", ts, 36.5, nil); err == nil {
		t.Error("NewTemperature accepted a wildcard device id")
	}
	handRolled["device_id"] = "AA:BB:CC:DD:EE:FF/+"
	handRolled["payload"] = map[string]any{"celsius": 36.5}
	if err := schema.Validate(mustRoundTrip(t, handRolled)); err == nil {
		t.Error("the shared schema accepted an over-long device_id")
	}
}

func mustRoundTrip(t *testing.T, v any) any {
	t.Helper()

	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	return doc
}
