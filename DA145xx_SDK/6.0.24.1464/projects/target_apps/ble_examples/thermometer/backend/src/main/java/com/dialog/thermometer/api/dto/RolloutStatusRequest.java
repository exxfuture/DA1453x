package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record RolloutStatusRequest(
        @NotBlank
        @Pattern(regexp = "^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$", message = "must be a colon-separated BD address")
        String bdAddr,
        @NotBlank
        @Pattern(regexp = "^(success|failed)$", message = "must be 'success' or 'failed'")
        String status,
        String errorDetail) {
}
