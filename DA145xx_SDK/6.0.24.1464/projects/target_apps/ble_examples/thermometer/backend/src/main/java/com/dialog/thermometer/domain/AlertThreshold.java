package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One complete set of temperature-tier boundaries, at one of three scopes
 * (see V1__init.sql's alert_thresholds table). Precedence is whole-row and
 * most-specific first — {@code doctor_override} beats {@code self} beats
 * {@code system} — resolved by
 * {@link com.dialog.thermometer.threshold.AlertThresholdService}.
 *
 * <p>Each field is named after the tier it turns ON at, not the tier below
 * it — {@code normalStartC} is the temperature at/above which a reading is
 * tagged Normal (and no longer Low), and so on up to
 * {@code highFeverStartC}. There is no field for "low": it's the implicit
 * floor tier, everything below {@code normalStartC}.
 *
 * <p>{@code subjectUserId} is whose readings the row applies to (NULL only
 * for the single system row); {@code setByUserId} is who wrote it.
 */
@Entity
@Table(name = "alert_thresholds")
public class AlertThreshold {

    /** The system-wide default, one row, {@code subjectUserId == null}. */
    public static final String SCOPE_SYSTEM = "system";
    /** A user's own setting for their own readings. */
    public static final String SCOPE_SELF = "self";
    /** A doctor's override for one consenting patient; keyed by (subject, setBy). */
    public static final String SCOPE_DOCTOR_OVERRIDE = "doctor_override";

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 16)
    private String scope;

    @Column(name = "subject_user_id", length = 64)
    private String subjectUserId;

    @Column(name = "set_by_user_id", nullable = false, length = 64)
    private String setByUserId;

    @Column(name = "normal_start_c", nullable = false)
    private double normalStartC;

    @Column(name = "elevated_start_c", nullable = false)
    private double elevatedStartC;

    @Column(name = "fever_start_c", nullable = false)
    private double feverStartC;

    @Column(name = "high_fever_start_c", nullable = false)
    private double highFeverStartC;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected AlertThreshold() {
        // JPA
    }

    public AlertThreshold(String scope, String subjectUserId, String setByUserId,
                           double normalStartC, double elevatedStartC, double feverStartC, double highFeverStartC) {
        this.scope = scope;
        this.subjectUserId = subjectUserId;
        this.setByUserId = setByUserId;
        this.normalStartC = normalStartC;
        this.elevatedStartC = elevatedStartC;
        this.feverStartC = feverStartC;
        this.highFeverStartC = highFeverStartC;
    }

    public UUID getId() {
        return id;
    }

    public String getScope() {
        return scope;
    }

    public String getSubjectUserId() {
        return subjectUserId;
    }

    public String getSetByUserId() {
        return setByUserId;
    }

    public double getNormalStartC() {
        return normalStartC;
    }

    public double getElevatedStartC() {
        return elevatedStartC;
    }

    public double getFeverStartC() {
        return feverStartC;
    }

    public double getHighFeverStartC() {
        return highFeverStartC;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    /**
     * Replaces the whole scale in one go — the boundaries are only ever
     * meaningful together, and the DB's monotonic check constraint would
     * reject a half-updated row anyway.
     */
    public void updateBoundaries(double normalStartC, double elevatedStartC, double feverStartC, double highFeverStartC,
                                  String setByUserId) {
        this.normalStartC = normalStartC;
        this.elevatedStartC = elevatedStartC;
        this.feverStartC = feverStartC;
        this.highFeverStartC = highFeverStartC;
        this.setByUserId = setByUserId;
        this.updatedAt = Instant.now();
    }
}
