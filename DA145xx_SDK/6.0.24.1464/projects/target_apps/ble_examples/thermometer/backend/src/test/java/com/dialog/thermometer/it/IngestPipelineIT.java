package com.dialog.thermometer.it;

import com.dialog.thermometer.api.dto.MeasurementResponse;
import com.dialog.thermometer.ingest.MeasurementEnvelope;
import com.dialog.thermometer.ingest.MeasurementIngestService;
import com.dialog.thermometer.live.BrokerCredentialService;
import com.dialog.thermometer.live.BrokerCredentialService.MintedCredential;
import com.dialog.thermometer.ingest.MqttGateway;
import com.dialog.thermometer.live.BrokerProvisioningException;
import org.eclipse.paho.client.mqttv3.IMqttToken;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end proof of architecture v3 §7/§8: a reading published over MQTT
 * reaches Postgres+TimescaleDB through the real ingest subscriber and is
 * retrievable via the REST history endpoint — no mocks on the data path —
 * plus dedup on redelivery and live-feed fan-out to a claimed device's
 * owner topic. Runs against real Mosquitto and TimescaleDB containers via
 * Testcontainers.
 *
 * <p>The broker is the hardened one ({@link MosquittoDynsecContainer}): no
 * anonymous access, every identity created at runtime by
 * {@link com.dialog.thermometer.live.BrokerCredentialService}. So this class also covers the broker-auth
 * contract itself — the publisher connects as the {@code collector} identity the
 * backend provisions, the live-feed subscriber uses a credential minted the way
 * {@code POST /api/live/credentials} mints one, and
 * {@link #brokerEnforcesPerIdentityAcls()} pins what each of them may and may
 * not do.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Testcontainers
class IngestPipelineIT {

    /** The owner every claim in this class is attributed to (security is disabled on the `test` profile). */
    private static final String LOCAL_DEV_USER = "local-dev-user";

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            DockerImageName.parse("timescale/timescaledb:latest-pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("thermometer")
            .withUsername("thermometer")
            .withPassword("thermometer");

    @Container
    static GenericContainer<?> mosquitto = MosquittoDynsecContainer.create();

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("thermometer.mqtt.broker-url", () -> MosquittoDynsecContainer.brokerUrl(mosquitto));
        registry.add("thermometer.mqtt.username", () -> MosquittoDynsecContainer.ADMIN_USERNAME);
        registry.add("thermometer.mqtt.password", () -> MosquittoDynsecContainer.ADMIN_PASSWORD);
        registry.add("thermometer.mqtt.collector-password", () -> MosquittoDynsecContainer.COLLECTOR_PASSWORD);
    }

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private MeasurementIngestService ingestService;

    @Autowired
    private BrokerCredentialService brokerCredentials;

    @Autowired
    private MqttGateway mqttGateway;

    /**
     * Lets the backend's own broker connection settle before each test.
     *
     * <p>Dynamic-security disconnects a client whose roles it changes, and the
     * very first provisioning pass attaches the {@code backend} role to this
     * service's own client — so there is exactly one reconnect early in the life
     * of a fresh broker. Nothing is lost across it (the session is persistent, so
     * the broker queues QoS 1 messages and Paho re-establishes the
     * subscriptions), but a reading published into that window arrives after the
     * reconnect rather than immediately, which is the difference between a test
     * that is timing-independent and one that is merely usually fast.
     *
     * <p>A successful mint is the signal that provisioning has completed; the
     * double check that follows is what confirms the connection then stayed up.
     */
    @BeforeEach
    void settleBrokerConnection() throws InterruptedException {
        mintWhenBrokerReady(LOCAL_DEV_USER);
        for (int attempt = 0; attempt < 80; attempt++) {
            if (mqttGateway.isConnected()) {
                Thread.sleep(250);
                if (mqttGateway.isConnected()) {
                    return;
                }
            }
            Thread.sleep(250);
        }
        throw new AssertionError("the backend never held a stable broker connection");
    }

    @Test
    void measurementPublishedOverMqttIsQueryableViaRestApi() throws Exception {
        String deviceId = "AA:BB:CC:DD:EE:01";

        // History is ownership-scoped (RbacIT covers the access-control matrix
        // in full) — claim the device first so this data-path test can read it
        // back as its owner ("local-dev-user", since security is disabled).
        ResponseEntity<String> claimResponse = restTemplate.postForEntity(
                "/api/devices/" + deviceId + "/claim", Map.of("model", "DA14535"), String.class);
        assertEquals(200, claimResponse.getStatusCode().value(), "device claim should succeed: " + claimResponse.getBody());

        publishAsCollector(deviceId, envelopeJson(deviceId, 21.34));

        MeasurementResponse[] result = pollForMeasurements(deviceId);

        assertNotNull(result, "measurement did not appear via REST within timeout");
        assertEquals(1, result.length);
        assertEquals(21.34, result[0].valueNum(), 0.001);
        assertEquals(deviceId, result[0].deviceId());
    }

    @Test
    void redeliveredMeasurementIsNotStoredTwice() {
        String deviceId = "AA:BB:CC:DD:EE:02";
        Instant ts = Instant.now();
        MeasurementEnvelope envelope = new MeasurementEnvelope(
                1, deviceId, "it-test", ts, "temperature", Map.of("celsius", 19.5), Map.of());

        boolean firstInsert = ingestService.ingest(envelope);
        boolean secondInsert = ingestService.ingest(envelope); // simulates MQTT QoS 1 redelivery

        assertTrue(firstInsert, "first ingest of a new reading should insert a row");
        assertFalse(secondInsert, "redelivered reading must be a no-op, not a duplicate row");
    }

    /**
     * The live path end to end, over the authenticated broker: the browser's own
     * minted credential subscribes to its own {@code live/…} topic, a collector
     * publishes a reading, and the backend fans it out. Also the only test that
     * proves the backend can publish there at all — the dynamic-security admin
     * role may subscribe to everything but publish nowhere except
     * {@code $CONTROL/…}, so this fails if the {@code backend} role
     * {@code BrokerCredentialService} provisions for itself is missing.
     */
    @Test
    void claimedDeviceReadingIsFannedOutToItsOwnerLiveTopic() throws Exception {
        String deviceId = "AA:BB:CC:DD:EE:03";

        ResponseEntity<String> claimResponse = restTemplate.postForEntity(
                "/api/devices/" + deviceId + "/claim", Map.of("model", "DA14535"), String.class);
        assertEquals(200, claimResponse.getStatusCode().value(), "device claim should succeed: " + claimResponse.getBody());

        MintedCredential credential = mintWhenBrokerReady(LOCAL_DEV_USER);
        LinkedBlockingQueue<String> liveMessages = new LinkedBlockingQueue<>();
        MqttClient liveSubscriber = MosquittoDynsecContainer.connectAs(mosquitto, credential.username(),
                credential.password());
        try {
            liveSubscriber.subscribe("live/" + LOCAL_DEV_USER + "/" + deviceId + "/#", 1,
                    (topic, message) -> liveMessages.offer(new String(message.getPayload(), StandardCharsets.UTF_8)));

            publishAsCollector(deviceId, envelopeJson(deviceId, 38.42));

            String liveMessage = liveMessages.poll(10, TimeUnit.SECONDS);
            assertNotNull(liveMessage, "expected a live-feed event on live/" + LOCAL_DEV_USER + "/" + deviceId);
            assertTrue(liveMessage.contains("38.42"), "live event should carry the reading: " + liveMessage);
        } finally {
            closeQuietly(liveSubscriber);
        }
    }

    /**
     * What the broker's own ACLs enforce, which is the half of the
     * authorization story no application code can be responsible for: nobody
     * connects without credentials, a minted browser credential reaches exactly
     * one user's live feed, and it cannot publish as a collector.
     *
     * <p>A refused <b>subscribe</b> is visible (granted QoS 0x80, or an
     * exception from Paho); a refused <b>publish</b> is not — MQTT 3.1.1 acks it
     * and the broker silently discards it — so that half is asserted by a
     * bounded wait on a listener that must never see the message, paired with
     * the same publish from an identity that <i>is</i> allowed, so the test
     * cannot pass by simply not delivering anything.
     */
    @Test
    void brokerEnforcesPerIdentityAcls() throws Exception {
        String deviceId = "AA:BB:CC:DD:EE:04";
        String collectorTopic = "v1/default/collector/" + deviceId + "/measurement/temperature";

        MintedCredential mine = mintWhenBrokerReady(LOCAL_DEV_USER);

        assertThrows(MqttException.class,
                () -> MosquittoDynsecContainer.connectAs(mosquitto, null, null),
                "anonymous connections must be refused");
        assertThrows(MqttException.class,
                () -> MosquittoDynsecContainer.connectAs(mosquitto, mine.username(), "not-the-password"),
                "a wrong password must be refused");

        MqttClient userClient = MosquittoDynsecContainer.connectAs(mosquitto, mine.username(), mine.password());
        MqttClient observer = MosquittoDynsecContainer.connectAs(mosquitto, MosquittoDynsecContainer.ADMIN_USERNAME,
                MosquittoDynsecContainer.ADMIN_PASSWORD);
        try {
            assertEquals(1, userClient.subscribeWithResponse("live/" + LOCAL_DEV_USER + "/#", 1).getGrantedQos()[0],
                    "a minted credential must be able to subscribe to its own live feed");

            assertTrue(subscribeRefused(userClient, "live/somebody-else/#"),
                    "a minted credential must not reach another user's live feed");

            // Refused publish: the collector topic segment is a trust label, so a
            // browser user must not be able to publish under it.
            LinkedBlockingQueue<String> seen = new LinkedBlockingQueue<>();
            observer.subscribe(collectorTopic, 1,
                    (topic, message) -> seen.offer(new String(message.getPayload(), StandardCharsets.UTF_8)));

            publish(userClient, collectorTopic, envelopeJson(deviceId, 36.6));
            assertNull(seen.poll(2, TimeUnit.SECONDS),
                    "a user credential must not be able to publish on a collector topic");

            // The same publish from the collector identity does arrive, so the
            // assertion above is about the ACL and not about a broken listener.
            MqttClient collector = MosquittoDynsecContainer.connectWhenProvisioned(mosquitto,
                    MosquittoDynsecContainer.COLLECTOR_USERNAME, MosquittoDynsecContainer.COLLECTOR_PASSWORD);
            try {
                publish(collector, collectorTopic, envelopeJson(deviceId, 36.7));
                assertNotNull(seen.poll(10, TimeUnit.SECONDS),
                        "the collector identity must be able to publish on its own topic");
            } finally {
                closeQuietly(collector);
            }
        } finally {
            closeQuietly(userClient);
            closeQuietly(observer);
        }
    }

    /**
     * Ownership on the broker path: a reading published under a user's own topic
     * segment for a device somebody else owns is dropped with an
     * {@code ingest.rejected} audit row and never stored (the topic's user
     * segment is trustworthy because the broker's ACLs make it so — see
     * {@link MeasurementIngestService#ingestFromTopic}).
     */
    @Test
    void readingPublishedByANonOwningUserIsRejected() {
        String deviceId = "AA:BB:CC:DD:EE:05";
        ResponseEntity<String> claim = restTemplate.postForEntity(
                "/api/devices/" + deviceId + "/claim", Map.of("model", "DA14535"), String.class);
        assertEquals(200, claim.getStatusCode().value(), "device claim should succeed: " + claim.getBody());

        MeasurementEnvelope envelope = new MeasurementEnvelope(
                1, deviceId, "it-test", Instant.now(), "temperature", Map.of("celsius", 40.0), Map.of());

        assertFalse(ingestService.ingestFromTopic(
                        "v1/default/somebody-else/" + deviceId + "/measurement/temperature", envelope),
                "a user may not write readings for a device owned by someone else");
        assertTrue(ingestService.ingestFromTopic(
                        "v1/default/" + LOCAL_DEV_USER + "/" + deviceId + "/measurement/temperature", envelope),
                "the owner's own topic segment is accepted");
        assertTrue(ingestService.ingestFromTopic(
                        "v1/default/collector/" + deviceId + "/measurement/temperature",
                        new MeasurementEnvelope(1, deviceId, "it-test", Instant.now().plusMillis(1), "temperature",
                                Map.of("celsius", 37.0), Map.of())),
                "a trusted collector writes for any device");
    }

    /**
     * Disconnects without masking the test's own failure: a broker-initiated
     * disconnect (dynamic-security kicks a client whose credential is rewritten)
     * would otherwise throw from a finally block and replace the assertion error
     * that actually matters.
     */
    private static void closeQuietly(MqttClient client) {
        try {
            if (client.isConnected()) {
                client.disconnect();
            }
            client.close();
        } catch (MqttException ignored) {
            // Nothing useful to do while tearing a test client down.
        }
    }

    /** True if the broker refused the subscription, however Paho chose to report it. */
    private static boolean subscribeRefused(MqttClient client, String topicFilter) {
        try {
            IMqttToken token = client.subscribeWithResponse(topicFilter, 1);
            int[] granted = token.getGrantedQos();
            return granted == null || granted.length == 0 || granted[0] == 0x80;
        } catch (MqttException refused) {
            return true;
        }
    }

    private static String envelopeJson(String deviceId, double celsius) {
        return """
                {
                  "v": 1,
                  "device_id": "%s",
                  "collector_id": "it-test",
                  "ts": "%s",
                  "type": "temperature",
                  "payload": { "celsius": %s }
                }
                """.formatted(deviceId, Instant.now().toString(), celsius);
    }

    /** Publishes as the {@code collector} identity, i.e. the way a real gateway does. */
    private void publishAsCollector(String deviceId, String json) throws Exception {
        MqttClient publisher = MosquittoDynsecContainer.connectWhenProvisioned(mosquitto,
                MosquittoDynsecContainer.COLLECTOR_USERNAME, MosquittoDynsecContainer.COLLECTOR_PASSWORD);
        try {
            publish(publisher, "v1/default/collector/" + deviceId + "/measurement/temperature", json);
        } finally {
            closeQuietly(publisher);
        }
    }

    private static void publish(MqttClient client, String topic, String json) throws MqttException {
        MqttMessage message = new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
        message.setQos(1);
        client.publish(topic, message);
    }

    /**
     * Minting needs the backend's own broker connection, which comes up
     * asynchronously — so this retries rather than assuming the context is
     * already connected by the time the first test runs.
     */
    private MintedCredential mintWhenBrokerReady(String userId) throws InterruptedException {
        BrokerProvisioningException lastFailure = null;
        for (int attempt = 0; attempt < 60; attempt++) {
            try {
                return brokerCredentials.mint(userId);
            } catch (BrokerProvisioningException notReady) {
                lastFailure = notReady;
                Thread.sleep(500);
            }
        }
        throw new AssertionError("could not mint a broker credential", lastFailure);
    }

    /**
     * Polls for up to 15 s. Generous on purpose: this is an asynchronous pipeline
     * (broker → subscriber → Postgres) and a tight budget here has nothing to do
     * with what the test is about.
     */
    private MeasurementResponse[] pollForMeasurements(String deviceId) throws InterruptedException {
        for (int i = 0; i < 75; i++) {
            ResponseEntity<MeasurementResponse[]> response = restTemplate.getForEntity(
                    "/api/measurements/" + deviceId + "?type=temperature", MeasurementResponse[].class);
            MeasurementResponse[] body = response.getBody();
            if (body != null && body.length > 0) {
                return body;
            }
            Thread.sleep(200);
        }
        return null;
    }
}
