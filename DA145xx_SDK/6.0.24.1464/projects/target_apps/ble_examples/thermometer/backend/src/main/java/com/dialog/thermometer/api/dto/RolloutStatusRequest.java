package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * What a collector reports back after attempting an OTA install.
 *
 * <p>{@code status} is the write side of the target-status vocabulary:
 * {@code success} or {@code failed}, validated here, joining the {@code pending}
 * default that {@code rollout_targets} rows start at. Those three strings are
 * also the keys of {@code RolloutSummaryResponse.statusCounts} — renaming one
 * without the other would leave a frontend bucket permanently empty.
 */
public record RolloutStatusRequest(
        @NotBlank
        @Pattern(regexp = "^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$", message = "must be a colon-separated BD address")
        String bdAddr,
        @NotBlank
        @Pattern(regexp = "^(success|failed)$", message = "must be 'success' or 'failed'")
        String status,
        String errorDetail) {
}
