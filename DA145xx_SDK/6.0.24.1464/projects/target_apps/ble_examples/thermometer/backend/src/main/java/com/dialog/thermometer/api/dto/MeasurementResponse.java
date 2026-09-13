package com.dialog.thermometer.api.dto;

import java.time.Instant;

public record MeasurementResponse(
        Instant ts,
        String deviceId,
        String type,
        Double valueNum,
        String payload,
        String collectorId) {
}
