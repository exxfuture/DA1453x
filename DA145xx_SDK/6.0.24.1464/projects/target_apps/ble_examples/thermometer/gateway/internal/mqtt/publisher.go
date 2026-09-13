// Package mqtt wraps the Eclipse Paho Go client with just the QoS 1
// publish behavior the gateway needs.
package mqtt

import (
	"fmt"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

type Options struct {
	BrokerURL string
	ClientID  string
	// Username/Password are optional — local dev Mosquitto allows anonymous
	// connections (see ../../../deploy/mosquitto.conf); production requires
	// them (or mTLS), per architecture v3 §8.2.
	Username string
	Password string
}

type Publisher struct {
	client pahomqtt.Client
}

func Connect(opts Options) (*Publisher, error) {
	clientOpts := pahomqtt.NewClientOptions().
		AddBroker(opts.BrokerURL).
		SetClientID(opts.ClientID).
		SetAutoReconnect(true)

	if opts.Username != "" {
		clientOpts.SetUsername(opts.Username)
		clientOpts.SetPassword(opts.Password)
	}

	client := pahomqtt.NewClient(clientOpts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		return nil, fmt.Errorf("mqtt connect to %s: %w", opts.BrokerURL, token.Error())
	}
	return &Publisher{client: client}, nil
}

// Publish sends payload at QoS 1 — at-least-once delivery, matching the
// backend ingest subscriber's ack-after-commit assumption (architecture v3 §8).
func (p *Publisher) Publish(topic string, payload []byte) error {
	token := p.client.Publish(topic, 1, false, payload)
	token.Wait()
	return token.Error()
}

func (p *Publisher) Disconnect() {
	p.client.Disconnect(250)
}
