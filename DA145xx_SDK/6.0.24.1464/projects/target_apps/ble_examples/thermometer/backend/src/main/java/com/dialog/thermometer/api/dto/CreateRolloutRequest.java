package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record CreateRolloutRequest(
        @NotBlank String version,
        @NotBlank String chipModel,
        @NotBlank String imageUrl,
        String deltaUrl,
        @NotBlank String sha256,
        @NotBlank String signature,
        @Min(1) @Max(100) int groupPercentage,
        @Min(0) @Max(100) int abortThresholdPct) {
}
