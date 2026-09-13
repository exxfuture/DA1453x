package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * A customer's note about their own readings, anchored either to a single
 * instant ({@code tsTo == null}) or to a span. Not foreign-keyed to
 * measurements — see V1__init.sql for why.
 */
@Entity
@Table(name = "measurement_annotations")
public class MeasurementAnnotation {

    @Id
    @GeneratedValue
    private UUID id;

    /** Author, and the only user allowed to edit or delete the row. */
    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    /** The device's BD address, matching measurements.device_id. */
    @Column(name = "device_id", nullable = false, length = 17)
    private String deviceId;

    @Column(name = "ts_from", nullable = false)
    private Instant tsFrom;

    @Column(name = "ts_to")
    private Instant tsTo;

    @Column(nullable = false)
    private String note;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected MeasurementAnnotation() {
        // JPA
    }

    public MeasurementAnnotation(String userId, String deviceId, Instant tsFrom, Instant tsTo, String note) {
        this.userId = userId;
        this.deviceId = deviceId;
        this.tsFrom = tsFrom;
        this.tsTo = tsTo;
        this.note = note;
    }

    public UUID getId() {
        return id;
    }

    public String getUserId() {
        return userId;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public Instant getTsFrom() {
        return tsFrom;
    }

    public Instant getTsTo() {
        return tsTo;
    }

    public String getNote() {
        return note;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void edit(Instant tsFrom, Instant tsTo, String note) {
        this.tsFrom = tsFrom;
        this.tsTo = tsTo;
        this.note = note;
        this.updatedAt = Instant.now();
    }
}
