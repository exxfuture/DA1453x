package mqtt

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	mochi "github.com/mochi-mqtt/server/v2"
	mochiauth "github.com/mochi-mqtt/server/v2/hooks/auth"
	"github.com/mochi-mqtt/server/v2/listeners"
	"github.com/mochi-mqtt/server/v2/packets"

	"thermometer-gateway/internal/auth"
)

const (
	testUsername = "collector"
	testPassword = "collector-dev"
	testTopic    = "v1/default/collector/AA:BB:CC:DD:EE:01/measurement/temperature"
)

type delivered struct {
	topic   string
	payload string
}

// startBroker runs an embedded mochi-mqtt broker on a random loopback port
// that requires testUsername/testPassword, so these tests cover the
// credential wiring (INF-04) as well as the publish path — no Docker, no
// external process (INF-22).
func startBroker(t *testing.T) (addr string, messages <-chan delivered) {
	t.Helper()

	server := mochi.New(&mochi.Options{
		InlineClient: true,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	ledger := &mochiauth.Ledger{
		Auth: mochiauth.AuthRules{{
			Username: testUsername,
			Password: testPassword,
			Allow:    true,
		}},
		ACL: mochiauth.ACLRules{{
			Filters: mochiauth.Filters{"#": mochiauth.ReadWrite},
		}},
	}
	if err := server.AddHook(new(mochiauth.Hook), &mochiauth.Options{Ledger: ledger}); err != nil {
		t.Fatalf("adding the auth hook: %v", err)
	}

	listener := listeners.NewTCP(listeners.Config{ID: "test-tcp", Address: "127.0.0.1:0"})
	if err := server.AddListener(listener); err != nil {
		t.Fatalf("binding the embedded broker: %v", err)
	}

	received := make(chan delivered, 16)
	if err := server.Subscribe("v1/#", 1, func(_ *mochi.Client, _ packets.Subscription, pk packets.Packet) {
		received <- delivered{topic: pk.TopicName, payload: string(pk.Payload)}
	}); err != nil {
		t.Fatalf("subscribing the inline client: %v", err)
	}

	go func() {
		_ = server.Serve()
	}()
	t.Cleanup(func() {
		_ = server.Close()
	})

	return "tcp://" + listener.Address(), received
}

// startStalledBroker accepts TCP connections and then goes silent. With
// connack=true it answers the CONNECT (so the client believes it is
// connected) but never acknowledges a PUBLISH — the exact failure mode that
// used to hang the gateway forever (INF-05).
func startStalledBroker(t *testing.T, connack bool) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	done := make(chan struct{})

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				if connack {
					if _, err := io.ReadFull(conn, make([]byte, 1)); err != nil { // start of CONNECT
						return
					}
					// Drain whatever else arrived, then accept the connection:
					// CONNACK, no session present, return code 0.
					_ = conn.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
					_, _ = conn.Read(make([]byte, 1024))
					_ = conn.SetReadDeadline(time.Time{})
					if _, err := conn.Write([]byte{0x20, 0x02, 0x00, 0x00}); err != nil {
						return
					}
				}
				<-done // and never answer anything again
			}()
		}
	}()
	t.Cleanup(func() {
		close(done)
		_ = listener.Close()
	})

	return "tcp://" + listener.Addr().String()
}

func testOptions(brokerURL, password string) Options {
	return Options{
		BrokerURL:   brokerURL,
		ClientID:    "gateway-test",
		Username:    testUsername,
		Credentials: auth.NewStaticTokenProvider(password),
		Timeout:     3 * time.Second,
	}
}

func TestConnectAndPublishWithCredentials(t *testing.T) {
	brokerURL, messages := startBroker(t)

	publisher, err := Connect(context.Background(), testOptions(brokerURL, testPassword))
	if err != nil {
		t.Fatalf("Connect() = %v, want a connected publisher", err)
	}
	defer publisher.Disconnect()

	if err := publisher.Publish(context.Background(), testTopic, []byte(`{"v":1}`)); err != nil {
		t.Fatalf("Publish() = %v, want nil", err)
	}

	select {
	case got := <-messages:
		if got.topic != testTopic {
			t.Errorf("topic = %q, want %q", got.topic, testTopic)
		}
		if got.payload != `{"v":1}` {
			t.Errorf("payload = %q, want the published bytes", got.payload)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the broker never received the publish")
	}
}

func TestConnectFailsWhenTheCredentialIsWrong(t *testing.T) {
	brokerURL, _ := startBroker(t)

	publisher, err := Connect(context.Background(), testOptions(brokerURL, "not-the-collector-password"))
	if err == nil {
		publisher.Disconnect()
		t.Fatal("Connect() succeeded with a wrong password")
	}
}

func TestConnectFailsWithoutCredentialsAgainstAnAuthenticatingBroker(t *testing.T) {
	brokerURL, _ := startBroker(t)

	opts := testOptions(brokerURL, "")
	opts.Credentials = nil
	opts.Username = ""

	publisher, err := Connect(context.Background(), opts)
	if err == nil {
		publisher.Disconnect()
		t.Fatal("Connect() succeeded anonymously against a broker with allow_anonymous false")
	}
}

func TestConnectFailsWhenTheBrokerIsUnreachable(t *testing.T) {
	// Bind and immediately release a port so nothing is listening on it.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("closing: %v", err)
	}

	start := time.Now()
	publisher, err := Connect(context.Background(), testOptions("tcp://"+addr, testPassword))
	if err == nil {
		publisher.Disconnect()
		t.Fatal("Connect() succeeded against a closed port")
	}
	if elapsed := time.Since(start); elapsed > 10*time.Second {
		t.Errorf("Connect() took %s to fail, want a bounded attempt", elapsed)
	}
}

func TestConnectTimesOutWhenTheBrokerNeverAcknowledges(t *testing.T) {
	brokerURL := startStalledBroker(t, false)

	opts := testOptions(brokerURL, testPassword)
	opts.Timeout = 300 * time.Millisecond

	start := time.Now()
	publisher, err := Connect(context.Background(), opts)
	if err == nil {
		publisher.Disconnect()
		t.Fatal("Connect() succeeded against a broker that never sent a CONNACK")
	}
	if !errors.Is(err, ErrTimeout) {
		t.Errorf("Connect() = %v, want ErrTimeout", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("Connect() took %s, want roughly the %s timeout", elapsed, opts.Timeout)
	}
}

func TestConnectReturnsWhenTheContextIsCancelled(t *testing.T) {
	brokerURL := startStalledBroker(t, false)

	opts := testOptions(brokerURL, testPassword)
	opts.Timeout = time.Minute // only the context can end this wait

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(150 * time.Millisecond)
		cancel()
	}()
	defer cancel()

	start := time.Now()
	publisher, err := Connect(ctx, opts)
	if err == nil {
		publisher.Disconnect()
		t.Fatal("Connect() succeeded against a broker that never sent a CONNACK")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Connect() = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("Connect() took %s to notice the cancellation", elapsed)
	}
}

func TestPublishTimesOutOnABrokerThatNeverAcks(t *testing.T) {
	brokerURL := startStalledBroker(t, true)

	opts := testOptions(brokerURL, testPassword)
	opts.Timeout = 300 * time.Millisecond

	publisher, err := Connect(context.Background(), opts)
	if err != nil {
		t.Fatalf("Connect() = %v, want the stalled broker's CONNACK to be accepted", err)
	}
	defer publisher.Disconnect()

	start := time.Now()
	err = publisher.Publish(context.Background(), testTopic, []byte(`{"v":1}`))
	if err == nil {
		t.Fatal("Publish() succeeded although no PUBACK was ever sent")
	}
	if !errors.Is(err, ErrTimeout) {
		t.Errorf("Publish() = %v, want ErrTimeout", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("Publish() blocked for %s, want roughly the %s timeout", elapsed, opts.Timeout)
	}
}

func TestPublishReturnsWhenTheContextIsCancelled(t *testing.T) {
	brokerURL := startStalledBroker(t, true)

	opts := testOptions(brokerURL, testPassword)
	opts.Timeout = time.Minute // only the context can end this wait

	publisher, err := Connect(context.Background(), opts)
	if err != nil {
		t.Fatalf("Connect() = %v, want the stalled broker's CONNACK to be accepted", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(150 * time.Millisecond)
		cancel()
	}()
	defer cancel()

	start := time.Now()
	err = publisher.Publish(ctx, testTopic, []byte(`{"v":1}`))
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Publish() = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("Publish() blocked for %s after cancellation", elapsed)
	}

	// Graceful shutdown must not hang either, even though the broker is still
	// unresponsive and a QoS 1 message is in flight.
	done := make(chan struct{})
	go func() {
		publisher.Disconnect()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Disconnect() hung on an unresponsive broker")
	}
}

func TestDisconnectIsSafeToCallOnAHealthyPublisher(t *testing.T) {
	brokerURL, _ := startBroker(t)

	publisher, err := Connect(context.Background(), testOptions(brokerURL, testPassword))
	if err != nil {
		t.Fatalf("Connect() = %v", err)
	}

	done := make(chan struct{})
	go func() {
		publisher.Disconnect()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Disconnect() did not return")
	}
}

func TestPublishAfterTheBrokerCameBackSucceeds(t *testing.T) {
	brokerURL, messages := startBroker(t)

	publisher, err := Connect(context.Background(), testOptions(brokerURL, testPassword))
	if err != nil {
		t.Fatalf("Connect() = %v", err)
	}
	defer publisher.Disconnect()

	for i := 0; i < 3; i++ {
		if err := publisher.Publish(context.Background(), testTopic, []byte(`{"v":1}`)); err != nil {
			t.Fatalf("Publish() %d = %v", i, err)
		}
	}
	for i := 0; i < 3; i++ {
		select {
		case <-messages:
		case <-time.After(5 * time.Second):
			t.Fatalf("only %d of 3 publishes arrived", i)
		}
	}
}
