package auth

import "testing"

// StaticTokenProvider is what internal/mqtt is handed as the broker
// credential; this assertion keeps the seam's shape from drifting.
var _ TokenProvider = (*StaticTokenProvider)(nil)

func TestStaticTokenProviderReturnsTheConfiguredToken(t *testing.T) {
	provider := NewStaticTokenProvider("test-token-123")

	token, err := provider.Token()
	if err != nil {
		t.Fatalf("Token() returned an error: %v", err)
	}
	if token != "test-token-123" {
		t.Errorf("Token() = %q, want %q", token, "test-token-123")
	}
}

// The provider is consulted on every (re)connect, so repeated calls must keep
// returning the same credential rather than draining a one-shot value.
func TestStaticTokenProviderIsStable(t *testing.T) {
	provider := NewStaticTokenProvider("collector-dev")

	for i := 0; i < 3; i++ {
		token, err := provider.Token()
		if err != nil {
			t.Fatalf("Token() call %d returned an error: %v", i, err)
		}
		if token != "collector-dev" {
			t.Fatalf("Token() call %d = %q, want the configured password", i, token)
		}
	}
}
