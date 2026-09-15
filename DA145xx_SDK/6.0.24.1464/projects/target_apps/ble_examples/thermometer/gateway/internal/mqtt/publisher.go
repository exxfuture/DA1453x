// Package mqtt wraps the Eclipse Paho Go client with just the QoS 1
// publish behavior the gateway needs.
//
// Every wait on a Paho token is bounded twice — by an explicit timeout and by
// the caller's context (INF-05). Paho's token.Wait() blocks forever, so a
// broker that completes the TCP handshake but never acknowledges a CONNECT or
// a PUBLISH used to hang the gateway's single loop goroutine and defeat
// SIGTERM handling entirely.
package mqtt

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"

	"thermometer-gateway/internal/auth"
)

const (
	// DefaultTimeout bounds a single connect or publish. Generous for a slow
	// uplink, still far below any human's patience for a stuck shutdown.
	DefaultTimeout = 10 * time.Second

	// waitSlice is how long we block inside Paho's WaitTimeout before looking
	// at the context again, i.e. the worst-case latency of a cancellation.
	waitSlice = 50 * time.Millisecond

	// qosAtLeastOnce matches the backend ingest subscriber's ack-after-commit
	// assumption (architecture v3 §8).
	qosAtLeastOnce = 1

	// disconnectQuiesceMs is how long Disconnect lets Paho flush in-flight
	// packets before dropping the socket.
	disconnectQuiesceMs = 250
)

// ErrTimeout is returned when the broker neither acknowledged nor refused an
// operation within the configured timeout.
var ErrTimeout = errors.New("broker did not respond in time")

type Options struct {
	BrokerURL string
	ClientID  string

	// Username is the broker identity. Gateways authenticate as the shared
	// `collector` client, whose dynamic-security role allows publishing to
	// v1/+/collector/+/measurement/+ and nothing else; the broker runs with
	// allow_anonymous false, so a connection without credentials is refused.
	Username string

	// Credentials supplies the password. It is consulted on every (re)connect
	// rather than once at startup, which is what makes auth.TokenProvider a
	// real seam for the renewable, backend-minted credential of architecture
	// v3 §8.2. Leave it nil only for a broker deliberately run with anonymous
	// access (the gateway's --allow-anonymous escape hatch).
	Credentials auth.TokenProvider

	// Timeout bounds each connect/publish. Zero means DefaultTimeout.
	Timeout time.Duration
}

type Publisher struct {
	client  pahomqtt.Client
	timeout time.Duration
}

// Connect dials the broker and waits for the CONNACK, bounded by ctx and
// opts.Timeout.
func Connect(ctx context.Context, opts Options) (*Publisher, error) {
	if opts.Timeout <= 0 {
		opts.Timeout = DefaultTimeout
	}

	clientOpts := pahomqtt.NewClientOptions().
		AddBroker(opts.BrokerURL).
		SetClientID(opts.ClientID).
		SetAutoReconnect(true).
		SetConnectTimeout(opts.Timeout).
		SetWriteTimeout(opts.Timeout)

	switch {
	case opts.Credentials != nil:
		username := opts.Username
		clientOpts.SetCredentialsProvider(func() (string, string) {
			password, err := opts.Credentials.Token()
			if err != nil {
				// Paho's callback cannot report an error; an empty password
				// makes the broker refuse the connection, which is the safe
				// outcome, and this line says why.
				log.Printf("mqtt: credential lookup failed, connecting without a password: %v", err)
				return username, ""
			}
			return username, password
		})
	case opts.Username != "":
		clientOpts.SetUsername(opts.Username)
	}

	client := pahomqtt.NewClient(clientOpts)
	if err := waitToken(ctx, client.Connect(), opts.Timeout); err != nil {
		// Release the socket and Paho's reconnect goroutine; without this a
		// timed-out attempt would keep retrying in the background.
		client.Disconnect(0)
		return nil, fmt.Errorf("mqtt connect to %s: %w", opts.BrokerURL, err)
	}
	return &Publisher{client: client, timeout: opts.Timeout}, nil
}

// Publish sends payload at QoS 1 — at-least-once delivery — and waits for the
// PUBACK, bounded by ctx and the configured timeout. A timeout or a cancelled
// context is reported as an error so the caller can buffer the reading and
// retry it (see internal/buffer).
func (p *Publisher) Publish(ctx context.Context, topic string, payload []byte) error {
	if err := waitToken(ctx, p.client.Publish(topic, qosAtLeastOnce, false, payload), p.timeout); err != nil {
		return fmt.Errorf("mqtt publish to %s: %w", topic, err)
	}
	return nil
}

// Disconnect closes the connection. It returns promptly even when the broker
// is unresponsive, because Paho's quiesce is itself bounded.
func (p *Publisher) Disconnect() {
	p.client.Disconnect(disconnectQuiesceMs)
}

// waitToken blocks until the Paho token completes, the context is done or
// timeout elapses — whichever happens first. It polls token.WaitTimeout in
// short slices instead of calling the unbounded token.Wait(), so cancellation
// is noticed within waitSlice even if the broker never answers.
func waitToken(ctx context.Context, token pahomqtt.Token, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return fmt.Errorf("%w (%s)", ErrTimeout, timeout)
		}
		if remaining > waitSlice {
			remaining = waitSlice
		}
		if token.WaitTimeout(remaining) {
			return token.Error()
		}
	}
}
