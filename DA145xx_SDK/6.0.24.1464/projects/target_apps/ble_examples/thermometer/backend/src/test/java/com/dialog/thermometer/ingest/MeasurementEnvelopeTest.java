package com.dialog.thermometer.ingest;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MeasurementEnvelopeTest {

    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test
    void parsesAWellFormedEnvelope() throws Exception {
        String json = """
                {
                  "v": 1,
                  "device_id": "48:23:35:F4:00:10",
                  "collector_id": "web-abc123",
                  "ts": "2026-07-26T12:34:56.789Z",
                  "type": "temperature",
                  "payload": { "celsius": 27.15 },
                  "meta": { "fw": "1.4.0", "battery_pct": 87 }
                }
                """;

        MeasurementEnvelope envelope = objectMapper.readValue(json, MeasurementEnvelope.class);

        assertEquals("48:23:35:F4:00:10", envelope.deviceId());
        assertEquals("temperature", envelope.type());
        assertEquals(27.15, ((Number) envelope.payload().get("celsius")).doubleValue(), 0.0001);
    }

    @Test
    void ignoresUnknownFieldsForForwardCompatibility() throws Exception {
        String json = """
                {
                  "v": 2,
                  "device_id": "48:23:35:F4:00:10",
                  "ts": "2026-07-26T12:34:56.789Z",
                  "type": "temperature",
                  "payload": { "celsius": 20.0 },
                  "some_future_field": "should not break parsing"
                }
                """;
        MeasurementEnvelope envelope = objectMapper.readValue(json, MeasurementEnvelope.class);
        assertEquals(20.0, ((Number) envelope.payload().get("celsius")).doubleValue(), 0.0001);
    }

    @Test
    void rejectsMissingDeviceId() {
        assertThrows(EnvelopeValidationException.class, () -> new MeasurementEnvelope(
                1, null, "c1", java.time.Instant.now(), "temperature", Map.of("celsius", 20.0), Map.of()));
    }

    @Test
    void rejectsMissingType() {
        assertThrows(EnvelopeValidationException.class, () -> new MeasurementEnvelope(
                1, "AA:BB:CC:DD:EE:FF", "c1", java.time.Instant.now(), " ", Map.of("celsius", 20.0), Map.of()));
    }

    @Test
    void rejectsEmptyPayload() {
        assertThrows(EnvelopeValidationException.class, () -> new MeasurementEnvelope(
                1, "AA:BB:CC:DD:EE:FF", "c1", java.time.Instant.now(), "temperature", Map.of(), Map.of()));
    }
}
