package com.dialog.thermometer.ingest;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.eclipse.paho.client.mqttv3.IMqttMessageListener;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Owns the single MQTT connection the backend uses both to subscribe
 * (ingest — {@link MqttIngestSubscriber}) and to publish (the live feed —
 * {@link MeasurementIngestService}), so neither of those has to depend on
 * the other for MQTT plumbing. Connects on a background thread with retry
 * so `docker compose up` doesn't depend on precise container start ordering.
 */
@Component
public class MqttGateway {

    private static final Logger log = LoggerFactory.getLogger(MqttGateway.class);

    private final String brokerUrl;
    private final String clientIdPrefix;
    private final List<Subscription> subscriptions = new CopyOnWriteArrayList<>();

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
                        @Value("${thermometer.mqtt.client-id-prefix:thermometer-backend}") String clientIdPrefix) {
        this.brokerUrl = brokerUrl;
        this.clientIdPrefix = clientIdPrefix;
    }

    @PostConstruct
    public void start() {
        connectExecutor.submit(this::connectWithRetry);
    }

    /**
     * Registers a topic subscription. Safe to call before the connection is
     * up — it's queued and applied as soon as {@code connectWithRetry}
     * succeeds (and reapplied automatically on Paho's own auto-reconnect,
     * since a fresh {@link MqttClient} re-subscribes in {@code doSubscribe}
     * only once per successful {@code connect()} call here).
     */
    public void subscribe(String topicFilter, int qos, IMqttMessageListener listener) {
        Subscription subscription = new Subscription(topicFilter, qos, listener);
        subscriptions.add(subscription);
        if (connected) {
            doSubscribe(subscription);
        }
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

    private void connectWithRetry() {
        String clientId = clientIdPrefix + "-" + UUID.randomUUID();
        int attempt = 0;
        while (!shuttingDown) {
            attempt++;
            try {
                MqttClient newClient = new MqttClient(brokerUrl, clientId, new MemoryPersistence());

                MqttConnectOptions options = new MqttConnectOptions();
                options.setCleanSession(false); // persistent session: redelivers unacked QoS 1 messages
                options.setAutomaticReconnect(true);
                options.setConnectionTimeout(10);
                options.setKeepAliveInterval(30);

                newClient.connect(options);
                client = newClient;
                connected = true;
                subscriptions.forEach(this::doSubscribe);

                log.info("MQTT gateway connected to {}", brokerUrl);
                return;
            } catch (MqttException e) {
                log.warn("MQTT connect attempt {} to {} failed ({}), retrying in 5s",
                        attempt, brokerUrl, e.getMessage());
                sleepQuietly(Duration.ofSeconds(5));
            }
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
