package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.MeasurementAnnotation;

import java.time.Instant;
import java.util.UUID;

/** A customer's note about their readings — see {@link MeasurementAnnotation}. */
public record AnnotationResponse(
        UUID id,
        String userId,
        String deviceBdAddr,
        Instant tsFrom,
        Instant tsTo,
        String note,
        Instant createdAt,
        Instant updatedAt) {

    public static AnnotationResponse from(MeasurementAnnotation annotation) {
        return new AnnotationResponse(
                annotation.getId(),
                annotation.getUserId(),
                annotation.getDeviceId(),
                annotation.getTsFrom(),
                annotation.getTsTo(),
                annotation.getNote(),
                annotation.getCreatedAt(),
                annotation.getUpdatedAt());
    }
}
