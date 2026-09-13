package auth

import "testing"

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
