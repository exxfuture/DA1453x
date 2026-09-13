package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

/**
 * @param tsTo null for a note pinned to a single instant; set for a span
 *             ("felt unwell all afternoon").
 */
public record CreateAnnotationRequest(
        @NotBlank @Size(max = 17) String deviceBdAddr,
        @NotNull Instant tsFrom,
        Instant tsTo,
        @NotBlank @Size(max = 2000) String note) {

    /** Mirrors ck_measurement_annotations_range (V1__init.sql). */
    @AssertTrue(message = "tsTo must not be before tsFrom")
    public boolean isRangeOrdered() {
        return tsTo == null || tsFrom == null || !tsTo.isBefore(tsFrom);
    }
}
