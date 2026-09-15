package com.dialog.thermometer.it;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.time.Duration;
import java.util.UUID;

/**
 * A Mosquitto container with the <b>dynamic-security plugin enabled and
 * anonymous access refused</b> — the same posture as the deployed broker
 * (deploy/mosquitto/mosquitto.conf), so the integration tests exercise real
 * authentication and real per-identity ACLs instead of an open broker that only
 * exists in the test suite.
 *
 * <p>The plugin needs an initial state file before the broker starts, which
 * {@code mosquitto_ctrl dynsec init} writes. Two details matter:
 *
 * <ul>
 *   <li>the {@code init} runs as root (the image's entrypoint has already
 *   chowned {@code /mosquitto} by then), so the file it writes is
 *   root-owned — and the broker, which drops to the {@code mosquitto} user and
 *   needs to <i>write</i> that file back on every change, then refuses to load
 *   it and quietly generates a default config with random passwords instead.
 *   Hence the explicit {@code chown};</li>
 *   <li>everything else — the collector identity, this service's own live-feed
 *   publish role, per-user credentials — is created at runtime by
 *   {@code live/BrokerCredentialService}, exactly as in production. Nothing is
 *   pre-seeded here.</li>
 * </ul>
 */
final class MosquittoDynsecContainer {

    /** The dynamic-security admin client the backend connects as. */
    static final String ADMIN_USERNAME = "admin";
    static final String ADMIN_PASSWORD = "adminpw";

    /** The identity every gateway/collector shares, provisioned by the backend on connect. */
    static final String COLLECTOR_USERNAME = "collector";
    static final String COLLECTOR_PASSWORD = "collector-dev";

    /** Long enough for a cold image pull plus the dynsec init, short enough to fail a broken setup. */
    private static final Duration STARTUP_TIMEOUT = Duration.ofMinutes(2);

    /** How long to keep retrying a connection that depends on the backend having provisioned an identity. */
    private static final Duration PROVISIONING_TIMEOUT = Duration.ofSeconds(30);

    private MosquittoDynsecContainer() {
    }

    static GenericContainer<?> create() {
        return new GenericContainer<>(DockerImageName.parse("eclipse-mosquitto:2"))
                .withExposedPorts(1883)
                .withCopyFileToContainer(MountableFile.forClasspathResource("mosquitto-test.conf"),
                        "/mosquitto/config/mosquitto.conf")
                .withCommand("sh", "-c",
                        "mosquitto_ctrl dynsec init /mosquitto/data/dynamic-security.json "
                                + ADMIN_USERNAME + " " + ADMIN_PASSWORD
                                + " && chown mosquitto:mosquitto /mosquitto/data/dynamic-security.json"
                                + " && exec mosquitto -c /mosquitto/config/mosquitto.conf")
                .waitingFor(Wait.forLogMessage(".*mosquitto version .* running.*\\n", 1)
                        .withStartupTimeout(STARTUP_TIMEOUT));
    }

    static String brokerUrl(GenericContainer<?> broker) {
        return "tcp://" + broker.getHost() + ":" + broker.getMappedPort(1883);
    }

    /** A connected client for an identity that exists from the start (the dynsec admin). */
    static MqttClient connectAs(GenericContainer<?> broker, String username, String password) throws MqttException {
        MqttClient client = new MqttClient(brokerUrl(broker), "test-" + username + "-" + UUID.randomUUID(),
                new MemoryPersistence());
        client.connect(options(username, password));
        return client;
    }

    /**
     * A connected client for an identity the <b>backend</b> creates on its own
     * MQTT connect, so the test has to wait for that to have happened rather
     * than assume it: retries until {@link #PROVISIONING_TIMEOUT}, since "not
     * authorised" here means "not provisioned yet", not "wrong password".
     */
    static MqttClient connectWhenProvisioned(GenericContainer<?> broker, String username, String password)
            throws InterruptedException {
        MqttException lastFailure = null;
        long deadline = System.nanoTime() + PROVISIONING_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            try {
                return connectAs(broker, username, password);
            } catch (MqttException notYet) {
                lastFailure = notYet;
                Thread.sleep(250);
            }
        }
        throw new AssertionError("broker identity '" + username + "' was never provisioned", lastFailure);
    }

    static MqttConnectOptions options(String username, String password) {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setCleanSession(true);
        options.setConnectionTimeout(5);
        if (username != null) {
            options.setUserName(username);
            options.setPassword(password.toCharArray());
        }
        return options;
    }
}
