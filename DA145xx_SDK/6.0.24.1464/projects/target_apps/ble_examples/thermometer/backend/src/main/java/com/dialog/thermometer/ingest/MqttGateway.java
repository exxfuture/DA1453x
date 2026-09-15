package com.dialog.thermometer.ingest;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.eclipse.paho.client.mqttv3.IMqttMessageListener;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Owns the single MQTT connection the backend uses both to subscribe
 * (ingest — {@link MqttIngestSubscriber}) and to publish (the live feed —
 * {@link MeasurementIngestService}, and the dynamic-security provisioning
 * commands of {@code live/BrokerCredentialService}), so none of those has to
 * depend on the others for MQTT plumbing. Connects on a background thread with
 * retry so `docker compose up` doesn't depend on precise container start
 * ordering.
 *
 * <p>The broker requires credentials — Mosquitto runs with the
 * dynamic-security plugin and {@code allow_anonymous false}, and this service
 * connects as that plugin's <b>admin</b> client
 * ({@code thermometer.mqtt.username}/{@code .password}). Nothing here connects
 * anonymously, on any profile.
 */
@Component
public class MqttGateway {

    private static final Logger log = LoggerFactory.getLogger(MqttGateway.class);

    private final String brokerUrl;
    private final String clientIdPrefix;
    private final String username;
    private final char[] password;
    private final List<Subscription> subscriptions = new CopyOnWriteArrayList<>();
    private final List<Runnable> connectListeners = new CopyOnWriteArrayList<>();

    private final ExecutorService connectExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "mqtt-gateway-connect");
        t.setDaemon(true);
        return t;
    });
    private volatile boolean shuttingDown = false;
    private volatile boolean connected = false;
    private volatile MqttClient client;

    private record Subscription(String topicFilter, int qos, IMqttMessageListener listener) {
    }

    public MqttGateway(@Value("${thermometer.mqtt.broker-url}") String brokerUrl,
                        @Value("${thermometer.mqtt.client-id-prefix:thermometer-backend}") String clientIdPrefix,
                        @Value("${thermometer.mqtt.username:}") String username,
                        @Value("${thermometer.mqtt.password:}") String password) {
        this.brokerUrl = brokerUrl;
        this.clientIdPrefix = clientIdPrefix;
        this.username = username;
        this.password = password != null ? password.toCharArray() : new char[0];
    }

    @PostConstruct
    public void start() {
        connectExecutor.submit(this::connectWithRetry);
    }

    /**
     * Registers a topic subscription. Safe to call before the connection is
     * up, or while it is temporarily down — it's queued and applied as soon
     * as {@code connectWithRetry} succeeds, and re-applied after every
     * Paho auto-reconnect ({@link ReconnectListener#connectComplete}).
     */
    public void subscribe(String topicFilter, int qos, IMqttMessageListener listener) {
        Subscription subscription = new Subscription(topicFilter, qos, listener);
        subscriptions.add(subscription);
        if (connected) {
            doSubscribe(subscription);
        }
    }

    /**
     * Runs {@code listener} after every successful connect — the first one and
     * every Paho auto-reconnect — which is what makes broker-side provisioning
     * idempotently re-applied rather than a one-shot startup step (a broker that
     * was restarted, or replaced, comes back needing it again).
     *
     * <p>Always dispatched on this gateway's own connect thread, never on
     * Paho's callback thread: a listener that publishes a command and waits for
     * the broker's reply would otherwise block the very thread that has to
     * deliver that reply.
     */
    public void onConnected(Runnable listener) {
        connectListeners.add(listener);
        if (connected) {
            connectExecutor.submit(() -> runListener(listener));
        }
    }

    /** True once the broker connection is up (and still believed to be). */
    public boolean isConnected() {
        MqttClient current = client;
        return connected && current != null && current.isConnected();
    }

    /**
     * Best-effort publish (QoS 1, but failures are logged and swallowed —
     * used for the live feed, where a missed update is not worth failing
     * the caller's request over; the durable measurement write already
     * happened before this is called).
     */
    public void publish(String topic, byte[] payload) {
        MqttClient current = client;
        if (!connected || current == null) {
            log.debug("Skipping publish to {} — MQTT gateway not connected", topic);
            return;
        }
        try {
            MqttMessage message = new MqttMessage(payload);
            message.setQos(1);
            current.publish(topic, message);
        } catch (MqttException e) {
            log.warn("Publish to {} failed: {}", topic, e.getMessage());
        }
    }

    /**
     * Publish that reports failure, for the control-plane traffic where a
     * dropped message is not "one missed chart update" but a provisioning
     * command that must not be assumed to have been applied.
     *
     * @throws MqttException if not connected, or if the publish fails
     */
    public void publishOrThrow(String topic, String payload) throws MqttException {
        MqttClient current = client;
        if (!connected || current == null) {
            throw new MqttException(MqttException.REASON_CODE_CLIENT_NOT_CONNECTED);
        }
        MqttMessage message = new MqttMessage(payload.getBytes(StandardCharsets.UTF_8));
        message.setQos(1);
        current.publish(topic, message);
    }

    private void connectWithRetry() {
        String clientId = clientIdPrefix + "-" + UUID.randomUUID();
        int attempt = 0;
        while (!shuttingDown) {
            attempt++;
            try {
                MqttClient newClient = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
                newClient.setCallback(new ReconnectListener());

                MqttConnectOptions options = new MqttConnectOptions();
                options.setCleanSession(false); // persistent session: redelivers unacked QoS 1 messages
                options.setAutomaticReconnect(true);
                options.setConnectionTimeout(10);
                options.setKeepAliveInterval(30);
                if (!username.isBlank()) {
                    options.setUserName(username);
                    options.setPassword(password);
                }

                newClient.connect(options);
                client = newClient;
                connected = true;
                subscriptions.forEach(this::doSubscribe);

                log.info("MQTT gateway connected to {} as '{}'", brokerUrl, username.isBlank() ? "(anonymous)" : username);
                connectListeners.forEach(this::runListener);
                return;
            } catch (MqttException e) {
                log.warn("MQTT connect attempt {} to {} failed ({}), retrying in 5s",
                        attempt, brokerUrl, e.getMessage());
                sleepQuietly(Duration.ofSeconds(5));
            }
        }
    }

    /**
     * Re-runs the connect listeners after Paho's own automatic reconnect, which
     * bypasses {@link #connectWithRetry} entirely.
     *
     * <p>Every registered subscription is re-applied too. Paho does restore the
     * subscriptions that existed before the connection dropped, but not one
     * that {@link #subscribe} registered <em>while</em> the connection was down
     * — and that window is not theoretical: on a fresh broker the very first
     * provisioning run ({@code BrokerCredentialService}) makes the
     * dynamic-security plugin disconnect this client, and
     * {@code MqttIngestSubscriber}'s startup subscription can land exactly
     * then. Without this re-apply, ingest silently never started until the
     * next backend restart. Re-subscribing to a filter that is already active
     * is idempotent on the broker side and simply replaces the listener here.
     */
    private class ReconnectListener implements MqttCallbackExtended {

        @Override
        public void connectComplete(boolean reconnect, String serverUri) {
            connected = true;
            if (reconnect) {
                log.info("MQTT gateway reconnected to {}", serverUri);
                subscriptions.forEach(MqttGateway.this::doSubscribe);
                connectExecutor.submit(() -> connectListeners.forEach(MqttGateway.this::runListener));
            }
        }

        @Override
        public void connectionLost(Throwable cause) {
            connected = false;
            log.warn("MQTT connection lost: {}", cause.getMessage());
        }

        @Override
        public void messageArrived(String topic, MqttMessage message) {
            // Every subscription registers its own listener; nothing is routed here.
        }

        @Override
        public void deliveryComplete(org.eclipse.paho.client.mqttv3.IMqttDeliveryToken token) {
            // QoS 1 delivery is awaited synchronously by the publisher.
        }
    }

    private void runListener(Runnable listener) {
        try {
            listener.run();
        } catch (RuntimeException e) {
            // A failing listener must not stop the connection from being used,
            // nor the other listeners from running: it is re-run on the next
            // connect anyway.
            log.warn("MQTT connect listener failed: {}", e.getMessage(), e);
        }
    }

    private void doSubscribe(Subscription subscription) {
        try {
            client.subscribe(subscription.topicFilter(), subscription.qos(), subscription.listener());
            log.info("Subscribed to '{}'", subscription.topicFilter());
        } catch (MqttException e) {
            log.error("Failed to subscribe to '{}': {}", subscription.topicFilter(), e.getMessage());
        }
    }

    private void sleepQuietly(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    @PreDestroy
    public void stop() {
        shuttingDown = true;
        connectExecutor.shutdownNow();
        try {
            if (client != null && client.isConnected()) {
                client.disconnect();
            }
        } catch (MqttException e) {
            log.warn("Error disconnecting MQTT client", e);
        }
    }
}
