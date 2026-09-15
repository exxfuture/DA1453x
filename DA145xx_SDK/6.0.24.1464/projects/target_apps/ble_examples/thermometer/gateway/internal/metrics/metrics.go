// Package metrics is the gateway's whole observability story: a handful of
// counters an operator can read without a log aggregator (INF-11).
//
// It writes the Prometheus text exposition format by hand instead of pulling
// in the client library — four counters and two gauges are not worth a
// dependency tree on a device where the binary is copied onto an SD card, and
// the format is stable and trivial. Scrape it with Prometheus, `curl`, or read
// the same numbers from the line the gateway logs on shutdown and every Nth
// publish failure.
package metrics

import (
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
)

// Counters are the gateway's process-lifetime totals. All methods are safe for
// concurrent use.
type Counters struct {
	published       atomic.Uint64
	publishFailures atomic.Uint64
	buffered        atomic.Uint64
	dropped         atomic.Uint64
	sensorFailures  atomic.Uint64
}

// IncPublished counts one envelope the broker acknowledged.
func (c *Counters) IncPublished() { c.published.Add(1) }

// IncPublishFailures counts one failed publish attempt and returns the new
// total, so the caller can log a summary every Nth failure.
func (c *Counters) IncPublishFailures() uint64 { return c.publishFailures.Add(1) }

// IncBuffered counts one reading retained for a later retry.
func (c *Counters) IncBuffered() { c.buffered.Add(1) }

// IncDropped counts one reading lost because the retry buffer was full.
func (c *Counters) IncDropped() { c.dropped.Add(1) }

// IncSensorFailures counts one failed sensor read.
func (c *Counters) IncSensorFailures() { c.sensorFailures.Add(1) }

// Snapshot is a consistent-enough point-in-time copy for logging and scraping.
type Snapshot struct {
	Published       uint64
	PublishFailures uint64
	Buffered        uint64
	Dropped         uint64
	SensorFailures  uint64
}

func (c *Counters) Snapshot() Snapshot {
	return Snapshot{
		Published:       c.published.Load(),
		PublishFailures: c.publishFailures.Load(),
		Buffered:        c.buffered.Load(),
		Dropped:         c.dropped.Load(),
		SensorFailures:  c.sensorFailures.Load(),
	}
}

// String is the one-line form used for the shutdown / every-Nth-failure log.
func (s Snapshot) String() string {
	return fmt.Sprintf("published=%d publish_failures=%d buffered=%d dropped=%d sensor_failures=%d",
		s.Published, s.PublishFailures, s.Buffered, s.Dropped, s.SensorFailures)
}

// BufferStats is the part of the retry buffer the endpoint reports as gauges.
type BufferStats interface {
	Len() int
	Cap() int
}

// Handler serves the counters at /metrics (and, for convenience on a device
// one pokes at with curl, at / too). buf may be nil.
func Handler(counters *Counters, buf BufferStats) http.Handler {
	mux := http.NewServeMux()
	expose := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		Write(w, counters.Snapshot(), buf)
	}
	mux.HandleFunc("/metrics", expose)
	mux.HandleFunc("/", expose)
	return mux
}

// Write renders one scrape in Prometheus text exposition format.
func Write(w io.Writer, snapshot Snapshot, buf BufferStats) {
	counters := []struct {
		name  string
		help  string
		value uint64
	}{
		{"gateway_published_total", "Measurement envelopes acknowledged by the broker.", snapshot.Published},
		{"gateway_publish_failures_total", "Publish attempts that failed (broker down, timeout, cancelled).", snapshot.PublishFailures},
		{"gateway_buffered_total", "Readings retained in the retry buffer after a failed publish.", snapshot.Buffered},
		{"gateway_dropped_total", "Readings lost because the retry buffer was full.", snapshot.Dropped},
		{"gateway_sensor_read_failures_total", "Failed sensor reads.", snapshot.SensorFailures},
	}
	for _, c := range counters {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n%s %d\n", c.name, c.help, c.name, c.name, c.value)
	}
	if buf != nil {
		fmt.Fprintf(w, "# HELP gateway_buffer_depth Readings currently waiting in the retry buffer.\n"+
			"# TYPE gateway_buffer_depth gauge\ngateway_buffer_depth %d\n", buf.Len())
		fmt.Fprintf(w, "# HELP gateway_buffer_capacity Configured retry buffer ceiling (--buffer-size).\n"+
			"# TYPE gateway_buffer_capacity gauge\ngateway_buffer_capacity %d\n", buf.Cap())
	}
}
