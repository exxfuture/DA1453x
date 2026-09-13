package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.AlertThreshold;
import com.dialog.thermometer.threshold.AlertThresholdService.ResolvedThresholds;

import java.time.Instant;
import java.util.UUID;

/**
 * A complete temperature-tier scale as returned by the API.
 *
 * <p>Each boundary is named after the tier it turns ON at — {@code
 * normalStartC} is the temperature at/above which a reading is tagged
 * Normal, and so on up to {@code highFeverStartC}. There is no field for
 * "low": it's the implicit floor tier, everything below {@code
 * normalStartC}.
 *
 * <p>{@code source} is the scope the boundaries actually came from —
 * {@code doctor_override}, {@code self}, {@code system}, or {@code fallback}
 * when no row exists anywhere. It is what lets the UI tell a patient "these
 * were set by your doctor" instead of silently showing someone else's scale.
 * {@code id}/{@code updatedAt} are only populated when a stored row is being
 * returned (the scoped GET/PUT endpoints), not for a resolved-effective read.
 */
public record ThresholdResponse(
        UUID id,
        String scope,
        String subjectUserId,
        String setByUserId,
        double normalStartC,
        double elevatedStartC,
        double feverStartC,
        double highFeverStartC,
        String source,
        Instant updatedAt) {

    /** Effective scale only — no stored row is implied, so identity fields stay null. */
    public static ThresholdResponse from(ResolvedThresholds resolved) {
        return new ThresholdResponse(null, null, null, null, resolved.normalStartC(), resolved.elevatedStartC(),
                resolved.feverStartC(), resolved.highFeverStartC(), resolved.source(), null);
    }

    public static ThresholdResponse from(AlertThreshold row) {
        return new ThresholdResponse(row.getId(), row.getScope(), row.getSubjectUserId(), row.getSetByUserId(),
                row.getNormalStartC(), row.getElevatedStartC(), row.getFeverStartC(), row.getHighFeverStartC(),
                row.getScope(), row.getUpdatedAt());
    }
}
