package buffer

import (
	"fmt"
	"sync"
	"testing"
)

func msg(i int) Message {
	return Message{Topic: "v1/default/collector/AA:BB/measurement/temperature", Payload: []byte(fmt.Sprintf("%d", i))}
}

func drain(t *testing.T, r *Ring) []string {
	t.Helper()

	var out []string
	for {
		m, ok := r.Peek()
		if !ok {
			return out
		}
		out = append(out, string(m.Payload))
		r.Discard()
	}
}

func TestRingKeepsInsertionOrder(t *testing.T) {
	r := NewRing(4)
	for i := 1; i <= 3; i++ {
		if dropped := r.Push(msg(i)); dropped {
			t.Fatalf("push %d dropped although the ring has room", i)
		}
	}
	if r.Len() != 3 {
		t.Fatalf("Len() = %d, want 3", r.Len())
	}

	got := drain(t, r)
	want := []string{"1", "2", "3"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("drained %v, want %v", got, want)
	}
	if r.Len() != 0 {
		t.Errorf("Len() = %d after draining, want 0", r.Len())
	}
}

func TestRingDropsTheOldestWhenFull(t *testing.T) {
	r := NewRing(3)
	for i := 1; i <= 3; i++ {
		r.Push(msg(i))
	}

	if dropped := r.Push(msg(4)); !dropped {
		t.Fatal("push into a full ring did not report a drop")
	}
	if r.Len() != 3 {
		t.Fatalf("Len() = %d, want the capacity 3", r.Len())
	}
	if r.Cap() != 3 {
		t.Fatalf("Cap() = %d, want 3", r.Cap())
	}

	got := drain(t, r)
	want := []string{"2", "3", "4"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("drained %v, want %v (oldest dropped, order kept)", got, want)
	}
}

func TestRingSurvivesWrapAround(t *testing.T) {
	r := NewRing(2)
	for i := 1; i <= 10; i++ {
		r.Push(msg(i))
		if i%3 == 0 {
			r.Discard()
		}
	}
	if r.Len() > r.Cap() {
		t.Fatalf("Len() = %d exceeds Cap() = %d", r.Len(), r.Cap())
	}
	for _, payload := range drain(t, r) {
		if payload == "" {
			t.Error("drained an empty message after wrap-around")
		}
	}
}

func TestPeekAndDiscardOnAnEmptyRingAreSafe(t *testing.T) {
	r := NewRing(2)
	if _, ok := r.Peek(); ok {
		t.Error("Peek() on an empty ring reported a message")
	}
	r.Discard() // must not panic
	if r.Len() != 0 {
		t.Errorf("Len() = %d, want 0", r.Len())
	}
}

func TestNewRingClampsANonPositiveCapacity(t *testing.T) {
	r := NewRing(0)
	if r.Cap() != 1 {
		t.Errorf("Cap() = %d, want the clamped minimum of 1", r.Cap())
	}
	r.Push(msg(1))
	if r.Len() != 1 {
		t.Errorf("Len() = %d, want 1", r.Len())
	}
}

// The /metrics handler reads Len/Cap from its own goroutine while the main
// loop mutates the ring; run under -race this pins that down.
func TestRingIsSafeForConcurrentUse(t *testing.T) {
	r := NewRing(8)
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; i < 500; i++ {
			r.Push(msg(i))
			if i%2 == 0 {
				r.Discard()
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 500; i++ {
			_ = r.Len()
			_ = r.Cap()
			_, _ = r.Peek()
		}
	}()
	wg.Wait()
}
