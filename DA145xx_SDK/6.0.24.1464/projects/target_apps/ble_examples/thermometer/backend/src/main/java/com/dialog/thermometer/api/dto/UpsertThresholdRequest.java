package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

/**
 * A complete tier scale to store at one scope. Always all four boundaries —
 * the scale is only meaningful as a whole, which is also why
 * {@link com.dialog.thermometer.domain.AlertThreshold#updateBoundaries} takes
 * them together. Each field is the temperature at/above which the named tier
 * turns on (see {@link ThresholdResponse}).
 *
 * <p>Primitives rather than boxed types on purpose: an omitted JSON field
 * binds to {@code 0.0}, which {@link #isMonotonic()} then rejects — so a
 * partial body fails validation instead of silently persisting zeros.
 */
public record UpsertThresholdRequest(
        @DecimalMin("20.0") @DecimalMax("50.0") double normalStartC,
        @DecimalMin("20.0") @DecimalMax("50.0") double elevatedStartC,
        @DecimalMin("20.0") @DecimalMax("50.0") double feverStartC,
        @DecimalMin("20.0") @DecimalMax("50.0") double highFeverStartC) {

    /**
     * Mirrors {@code ck_alert_thresholds_monotonic} (V1__init.sql). Checked
     * here as well as in the database so the caller gets a 400 with a
     * message rather than a 500 from a constraint violation — the database
     * check stays the authority, this is the friendly copy of it.
     */
    @AssertTrue(message = "thresholds must be strictly increasing: normalStartC < elevatedStartC < feverStartC < highFeverStartC")
    public boolean isMonotonic() {
        return normalStartC < elevatedStartC && elevatedStartC < feverStartC && feverStartC < highFeverStartC;
    }
}
