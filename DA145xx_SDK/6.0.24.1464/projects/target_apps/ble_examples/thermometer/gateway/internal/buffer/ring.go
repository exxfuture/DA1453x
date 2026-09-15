// Package buffer holds the gateway's bounded in-memory retry buffer.
//
// Without it a broker outage silently loses every reading taken during the
// outage (INF-11). With it the readings a failed publish produced are kept in
// order and replayed on the next tick that reaches the broker, up to a
// configurable ceiling — bounded on purpose: an edge SBC must not trade a
// broker outage for an out-of-memory kill, so the oldest reading is dropped
// (and counted) when the buffer is full.
//
// This is deliberately not a disk queue. Readings are small and frequent, the
// backend tolerates gaps, and a crash-safe store on an SD card is a different
// design with different failure modes (see gateway/README.md).
package buffer

import "sync"

// Message is one pending publish: the topic and the already-marshalled
// envelope, so a replay re-sends exactly the bytes the original attempt did.
type Message struct {
	Topic   string
	Payload []byte
}

// Ring is a fixed-capacity FIFO of pending messages. It is safe for
// concurrent use: the main loop pushes and drains it while the /metrics
// handler reads its depth.
type Ring struct {
	mu    sync.Mutex
	items []Message
	head  int
	count int
}

// NewRing returns a ring holding at most capacity messages. A capacity below
// one is raised to one — a buffer that cannot hold anything would silently
// turn into the pre-INF-11 behaviour.
func NewRing(capacity int) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{items: make([]Message, capacity)}
}

// Push appends msg. It reports whether an older message had to be dropped to
// make room.
func (r *Ring) Push(msg Message) (dropped bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.count == len(r.items) {
		// Full: overwrite the oldest entry and move the head past it.
		r.items[r.head] = msg
		r.head = (r.head + 1) % len(r.items)
		return true
	}
	r.items[(r.head+r.count)%len(r.items)] = msg
	r.count++
	return false
}

// Peek returns the oldest message without removing it, so a failed replay can
// be retried on the next tick instead of being lost. ok is false when the
// ring is empty.
func (r *Ring) Peek() (msg Message, ok bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.count == 0 {
		return Message{}, false
	}
	return r.items[r.head], true
}

// Discard removes the oldest message. It is a no-op on an empty ring.
func (r *Ring) Discard() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.count == 0 {
		return
	}
	r.items[r.head] = Message{} // let the payload be collected
	r.head = (r.head + 1) % len(r.items)
	r.count--
}

// Len is the number of pending messages.
func (r *Ring) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count
}

// Cap is the configured ceiling.
func (r *Ring) Cap() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.items)
}
