package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeBuffer struct{ length, capacity int }

func (f fakeBuffer) Len() int { return f.length }
func (f fakeBuffer) Cap() int { return f.capacity }

func TestCountersAccumulate(t *testing.T) {
	var c Counters
	c.IncPublished()
	c.IncPublished()
	c.IncBuffered()
	c.IncDropped()
	c.IncSensorFailures()
	if total := c.IncPublishFailures(); total != 1 {
		t.Errorf("IncPublishFailures() = %d, want 1", total)
	}
	if total := c.IncPublishFailures(); total != 2 {
		t.Errorf("second IncPublishFailures() = %d, want 2", total)
	}

	got := c.Snapshot()
	want := Snapshot{Published: 2, PublishFailures: 2, Buffered: 1, Dropped: 1, SensorFailures: 1}
	if got != want {
		t.Errorf("Snapshot() = %+v, want %+v", got, want)
	}
	if !strings.Contains(got.String(), "published=2 publish_failures=2") {
		t.Errorf("Snapshot().String() = %q, want the shutdown log line form", got.String())
	}
}

func TestHandlerServesPrometheusText(t *testing.T) {
	var c Counters
	c.IncPublished()
	c.IncPublishFailures()
	c.IncBuffered()

	for _, path := range []string{"/metrics", "/"} {
		recorder := httptest.NewRecorder()
		Handler(&c, fakeBuffer{length: 3, capacity: 256}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))

		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s = %d, want 200", path, recorder.Code)
		}
		if ct := recorder.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
			t.Errorf("Content-Type = %q, want text/plain", ct)
		}

		body := recorder.Body.String()
		for _, line := range []string{
			"# TYPE gateway_published_total counter",
			"gateway_published_total 1",
			"gateway_publish_failures_total 1",
			"gateway_buffered_total 1",
			"gateway_dropped_total 0",
			"gateway_sensor_read_failures_total 0",
			"# TYPE gateway_buffer_depth gauge",
			"gateway_buffer_depth 3",
			"gateway_buffer_capacity 256",
		} {
			if !strings.Contains(body, line) {
				t.Errorf("GET %s body is missing %q:\n%s", path, line, body)
			}
		}
	}
}

func TestWriteOmitsTheGaugesWithoutABuffer(t *testing.T) {
	var out strings.Builder
	Write(&out, Snapshot{Published: 7}, nil)

	if !strings.Contains(out.String(), "gateway_published_total 7") {
		t.Errorf("missing counter:\n%s", out.String())
	}
	if strings.Contains(out.String(), "gateway_buffer_depth") {
		t.Errorf("gauge emitted without a buffer:\n%s", out.String())
	}
}
