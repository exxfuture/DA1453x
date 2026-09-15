package com.dialog.thermometer.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Parity test against the <b>shared</b> wire-format definition:
 * {@code ../schema/measurement-envelope.v1.schema.json}, which the Go gateway
 * and the web app validate against in their own suites. The envelope exists in
 * three languages, and before this file a field rename on any one side
 * desynchronised the other two with no compile-time or CI signal at all.
 *
 * <p>The schema is read <b>from disk</b>, not copied into the test resources, on
 * purpose: a copy would drift, which is the exact failure this is here to
 * prevent. That makes the path — relative to this Maven module — part of the
 * test, and a moved schema file fails loudly rather than silently stopping to
 * check anything.
 *
 * <p>Two directions are checked, because either alone is passable by a broken
 * implementation: what this service <i>produces</i> must satisfy the schema, and
 * what the schema <i>rejects</i> the record must reject too.
 */
class MeasurementEnvelopeSchemaTest {

    /** Relative to backend/ (the Maven module root, i.e. the working directory of a Surefire run). */
    private static final Path SCHEMA_PATH = Path.of("..", "schema", "measurement-envelope.v1.schema.json");

    /**
     * The same configuration Spring Boot gives the application's ObjectMapper:
     * the JavaTimeModule with {@code WRITE_DATES_AS_TIMESTAMPS} disabled, which
     * is what makes {@code ts} an ISO-8601 string rather than a float the schema
     * would reject. Testing with a differently-configured mapper would prove
     * nothing about what actually goes on the wire.
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private static JsonSchema schema;

    @BeforeAll
    static void loadSchema() throws IOException {
        assertTrue(Files.exists(SCHEMA_PATH),
                "shared envelope schema not found at " + SCHEMA_PATH.toAbsolutePath()
                        + " — it is the source of truth for Go, Java and TypeScript; if it moved, fix this path");
        try (var in = Files.newInputStream(SCHEMA_PATH)) {
            schema = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(in);
        }
    }

    @Test
    void serialisedEnvelopeIsSchemaValid() throws Exception {
        MeasurementEnvelope envelope = new MeasurementEnvelope(1, "48:23:35:F4:00:10", "web-abc123",
                Instant.parse("2026-07-26T12:34:56.789Z"), "temperature", Map.of("celsius", 27.15), null);

        assertNoViolations(envelope);
    }

    @Test
    void envelopeWithMetaIsSchemaValid() throws Exception {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("battery_pct", 87);
        meta.put("rssi_dbm", -64);
        meta.put("fw_version", "1.4.0");
        MeasurementEnvelope envelope = new MeasurementEnvelope(1, "48:23:35:F4:00:10", "gateway-1",
                Instant.now(), "temperature", Map.of("celsius", 36.8), meta);

        assertNoViolations(envelope);
    }

    @Test
    void everyRegisteredMeasurementTypeRoundTripsThroughTheSchema() throws Exception {
        // The three types measurement_types is seeded with in V1__init.sql and
        // that MeasurementIngestService.extractPrimaryValue knows a scalar for —
        // each has its own payload contract in the schema's allOf.
        assertNoViolations(new MeasurementEnvelope(1, "48:23:35:F4:00:10", "gateway-1", Instant.now(),
                "temperature", Map.of("celsius", 36.8), null));
        assertNoViolations(new MeasurementEnvelope(1, "48:23:35:F4:00:10", "gateway-1", Instant.now(),
                "humidity", Map.of("relative_humidity_pct", 44.0), null));
        assertNoViolations(new MeasurementEnvelope(1, "48:23:35:F4:00:10", "gateway-1", Instant.now(),
                "battery", Map.of("percent", 91), null));
    }

    @Test
    void roundTripThroughJacksonPreservesEverySchemaField() throws Exception {
        MeasurementEnvelope original = new MeasurementEnvelope(1, "48:23:35:F4:00:10", "web-abc123",
                Instant.parse("2026-07-26T12:34:56.789Z"), "temperature", Map.of("celsius", 27.15),
                Map.of("fw_version", "1.4.0"));

        MeasurementEnvelope decoded = objectMapper.readValue(objectMapper.writeValueAsString(original),
                MeasurementEnvelope.class);

        assertEquals(original, decoded, "encode → decode must be lossless for every field the schema requires");
        assertNoViolations(decoded);
    }

    /**
     * The other direction: the record's own validation refuses exactly what the
     * schema's {@code required} list refuses, so a malformed document cannot get
     * further into this service than the constructor.
     */
    @Test
    void recordRejectsWhatTheSchemaRejects() throws Exception {
        Instant ts = Instant.parse("2026-07-26T12:34:56.789Z");
        Map<String, Object> payload = Map.of("celsius", 27.15);

        assertTrue(schemaRejects(documentWithout("device_id")), "schema requires device_id");
        assertThrows(EnvelopeValidationException.class,
                () -> new MeasurementEnvelope(1, null, "c1", ts, "temperature", payload, null));

        assertTrue(schemaRejects(documentWithout("type")), "schema requires type");
        assertThrows(EnvelopeValidationException.class,
                () -> new MeasurementEnvelope(1, "48:23:35:F4:00:10", "c1", ts, null, payload, null));

        assertTrue(schemaRejects(documentWithout("ts")), "schema requires ts");
        assertThrows(EnvelopeValidationException.class,
                () -> new MeasurementEnvelope(1, "48:23:35:F4:00:10", "c1", null, "temperature", payload, null));

        assertTrue(schemaRejects(documentWithout("payload")), "schema requires payload");
        assertThrows(EnvelopeValidationException.class,
                () -> new MeasurementEnvelope(1, "48:23:35:F4:00:10", "c1", ts, "temperature", null, null));

        // An empty payload is minProperties: 1 in the schema and "payload is
        // required" in the record — the same rule, spelled twice.
        assertTrue(schemaRejects(objectMapper.readTree("""
                {"v":1,"device_id":"48:23:35:F4:00:10","collector_id":"c1",
                 "ts":"2026-07-26T12:34:56.789Z","type":"temperature","payload":{}}
                """)), "schema requires a non-empty payload");
        assertThrows(EnvelopeValidationException.class,
                () -> new MeasurementEnvelope(1, "48:23:35:F4:00:10", "c1", ts, "temperature", Map.of(), null));
    }

    /** A complete document minus one required field, so each assertion above tests one rule. */
    private JsonNode documentWithout(String field) throws Exception {
        Map<String, Object> document = new LinkedHashMap<>();
        document.put("v", 1);
        document.put("device_id", "48:23:35:F4:00:10");
        document.put("collector_id", "c1");
        document.put("ts", "2026-07-26T12:34:56.789Z");
        document.put("type", "temperature");
        document.put("payload", Map.of("celsius", 27.15));
        document.remove(field);
        return objectMapper.valueToTree(document);
    }

    private boolean schemaRejects(JsonNode document) {
        return !schema.validate(document).isEmpty();
    }

    private void assertNoViolations(MeasurementEnvelope envelope) throws Exception {
        JsonNode document = objectMapper.readTree(objectMapper.writeValueAsString(envelope));
        Set<ValidationMessage> violations = schema.validate(document);
        assertTrue(violations.isEmpty(), () -> "envelope does not satisfy " + SCHEMA_PATH + ": " + violations
                + "\nserialised as: " + document);
        assertFalse(document.has("meta") && document.get("meta").isNull(),
                "meta must be omitted rather than null when absent, per the schema's description");
    }
}
