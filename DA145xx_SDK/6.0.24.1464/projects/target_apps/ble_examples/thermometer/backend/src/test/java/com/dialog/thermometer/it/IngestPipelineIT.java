package com.dialog.thermometer.it;

import com.dialog.thermometer.api.dto.MeasurementResponse;
import com.dialog.thermometer.ingest.MeasurementEnvelope;
import com.dialog.thermometer.ingest.MeasurementIngestService;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
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
import org.testcontainers.utility.MountableFile;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end proof of architecture v3 §7/§8: a reading published over MQTT
 * reaches Postgres+TimescaleDB through the real ingest subscriber and is
 * retrievable via the REST history endpoint — no mocks on the data path —
 * plus dedup on redelivery and live-feed fan-out to a claimed device's
 * owner topic. Runs against real Mosquitto and TimescaleDB containers via
 * Testcontainers.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Testcontainers
class IngestPipelineIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            DockerImageName.parse("timescale/timescaledb:latest-pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("thermometer")
            .withUsername("thermometer")
            .withPassword("thermometer");

    @Container
    static GenericContainer<?> mosquitto = new GenericContainer<>(DockerImageName.parse("eclipse-mosquitto:2"))
            .withExposedPorts(1883)
            .withCopyFileToContainer(MountableFile.forClasspathResource("mosquitto-test.conf"),
                    "/mosquitto/config/mosquitto.conf");

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("thermometer.mqtt.broker-url",
                () -> "tcp://" + mosquitto.getHost() + ":" + mosquitto.getMappedPort(1883));
    }

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private MeasurementIngestService ingestService;

    @Test
    void measurementPublishedOverMqttIsQueryableViaRestApi() throws Exception {
        String deviceId = "AA:BB:CC:DD:EE:01";
        String brokerUrl = "tcp://" + mosquitto.getHost() + ":" + mosquitto.getMappedPort(1883);

        // History is ownership-scoped (RbacIT covers the access-control matrix
        // in full) — claim the device first so this data-path test can read it
        // back as its owner ("local-dev-user", since security is disabled).
        ResponseEntity<String> claimResponse = restTemplate.postForEntity(
                "/api/devices/" + deviceId + "/claim", Map.of("model", "DA14535"), String.class);
        assertEquals(200, claimResponse.getStatusCode().value(), "device claim should succeed: " + claimResponse.getBody());

        String json = """
                {
                  "v": 1,
                  "device_id": "%s",
                  "collector_id": "it-test",
                  "ts": "%s",
                  "type": "temperature",
                  "payload": { "celsius": 21.34 }
                }
                """.formatted(deviceId, Instant.now().toString());

        MqttClient publisher = new MqttClient(brokerUrl, "test-publisher-" + UUID.randomUUID(), new MemoryPersistence());
        publisher.connect();
        try {
            MqttMessage message = new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
            message.setQos(1);
            publisher.publish("v1/tenant1/user1/" + deviceId + "/measurement/temperature", message);
        } finally {
            publisher.disconnect();
            publisher.close();
        }

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

    @Test
    void claimedDeviceReadingIsFannedOutToItsOwnerLiveTopic() throws Exception {
        String deviceId = "AA:BB:CC:DD:EE:03";
        String brokerUrl = "tcp://" + mosquitto.getHost() + ":" + mosquitto.getMappedPort(1883);

        // Security is disabled on the `test` profile, so DeviceController
        // attributes the claim to its "local-dev-user" fallback subject.
        ResponseEntity<String> claimResponse = restTemplate.postForEntity(
                "/api/devices/" + deviceId + "/claim", Map.of("model", "DA14535"), String.class);
        assertEquals(200, claimResponse.getStatusCode().value(), "device claim should succeed: " + claimResponse.getBody());

        LinkedBlockingQueue<String> liveMessages = new LinkedBlockingQueue<>();
        MqttClient liveSubscriber = new MqttClient(brokerUrl, "test-live-subscriber-" + UUID.randomUUID(), new MemoryPersistence());
        liveSubscriber.connect();
        liveSubscriber.subscribe("live/local-dev-user/" + deviceId + "/#", 1,
                (topic, message) -> liveMessages.offer(new String(message.getPayload(), StandardCharsets.UTF_8)));

        try {
            String json = """
                    {
                      "v": 1,
                      "device_id": "%s",
                      "collector_id": "it-test",
                      "ts": "%s",
                      "type": "temperature",
                      "payload": { "celsius": 38.42 }
                    }
                    """.formatted(deviceId, Instant.now().toString());

            MqttClient publisher = new MqttClient(brokerUrl, "test-publisher-" + UUID.randomUUID(), new MemoryPersistence());
            publisher.connect();
            try {
                MqttMessage message = new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
                message.setQos(1);
                publisher.publish("v1/tenant1/user1/" + deviceId + "/measurement/temperature", message);
            } finally {
                publisher.disconnect();
                publisher.close();
            }

            String liveMessage = liveMessages.poll(10, TimeUnit.SECONDS);
            assertNotNull(liveMessage, "expected a live-feed event on live/local-dev-user/" + deviceId + "/temperature");
            assertTrue(liveMessage.contains("38.42"), "live event should carry the reading: " + liveMessage);
        } finally {
            liveSubscriber.disconnect();
            liveSubscriber.close();
        }
    }

    private MeasurementResponse[] pollForMeasurements(String deviceId) throws InterruptedException {
        for (int i = 0; i < 25; i++) {
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
