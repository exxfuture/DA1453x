package com.dialog.thermometer.ingest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Map;

/**
 * The one wire envelope shared by every collector (mobile, web, gateway) and
 * every measurement type, per architecture v2 §6.2 / v3 §8. New measurement
 * types add a registry entry, not a new envelope shape.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record MeasurementEnvelope(
        int v,
        @JsonProperty("device_id") String deviceId,
        @JsonProperty("collector_id") String collectorId,
        Instant ts,
        String type,
        Map<String, Object> payload,
        Map<String, Object> meta) {

    public MeasurementEnvelope {
        if (deviceId == null || deviceId.isBlank()) {
            throw new EnvelopeValidationException("device_id is required");
        }
        if (type == null || type.isBlank()) {
            throw new EnvelopeValidationException("type is required");
        }
        if (ts == null) {
            throw new EnvelopeValidationException("ts is required");
        }
        if (payload == null || payload.isEmpty()) {
            throw new EnvelopeValidationException("payload is required");
        }
    }
}
