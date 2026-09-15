// Package auth supplies the credential the gateway authenticates to the
// broker with.
//
// Today that credential is the password of the shared `collector` broker
// client: Mosquitto runs with the dynamic-security plugin and
// allow_anonymous false, the backend provisions the `collector` client and its
// publish-only role, and the gateway is configured with the same password
// (--mqtt-password / GATEWAY_MQTT_PASSWORD). StaticTokenProvider is that: a
// fixed value from configuration, wired into internal/mqtt as Paho's
// credentials provider so it is re-read on every (re)connect.
//
// Architecture v3 §8.2 wants a short-lived, device-scoped credential minted
// by the backend and renewed on check-in — the same shape the browser clients
// already get from POST /api/live/credentials. That endpoint does not yet
// accept gateways, so TokenProvider is the seam it will plug into: a
// renewing provider replaces StaticTokenProvider and nothing else changes,
// because the provider is consulted per connection attempt rather than once
// at startup.
package auth

// TokenProvider supplies the password the gateway presents to the broker.
// Implementations must be safe to call from the MQTT client's reconnect
// goroutine.
type TokenProvider interface {
	Token() (string, error)
}

// StaticTokenProvider returns one configured value forever — the shared
// `collector` password in the current deployment.
type StaticTokenProvider struct {
	token string
}

func NewStaticTokenProvider(token string) *StaticTokenProvider {
	return &StaticTokenProvider{token: token}
}

func (s *StaticTokenProvider) Token() (string, error) {
	return s.token, nil
}
