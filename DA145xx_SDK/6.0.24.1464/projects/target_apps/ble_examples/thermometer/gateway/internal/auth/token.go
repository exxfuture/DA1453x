// Package auth supplies the credential the gateway authenticates to the
// broker with. Architecture v3 §8.2 calls for a short-lived, device-scoped
// JWT renewed on check-in against a backend endpoint — that endpoint
// doesn't exist yet, so TokenProvider is the seam it'll plug into.
// StaticTokenProvider is today's stand-in: a fixed value from configuration.
package auth

type TokenProvider interface {
	Token() (string, error)
}

type StaticTokenProvider struct {
	token string
}

func NewStaticTokenProvider(token string) *StaticTokenProvider {
	return &StaticTokenProvider{token: token}
}

func (s *StaticTokenProvider) Token() (string, error) {
	return s.token, nil
}
