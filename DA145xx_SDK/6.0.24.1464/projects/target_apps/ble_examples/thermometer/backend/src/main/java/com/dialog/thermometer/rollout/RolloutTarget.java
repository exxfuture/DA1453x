package com.dialog.thermometer.rollout;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** Per-device status of one rollout — the "did it work" side of the OTA loop. */
@Entity
@Table(name = "rollout_targets")
@IdClass(RolloutTargetId.class)
public class RolloutTarget {

    @Id
    @Column(name = "rollout_id")
    private UUID rollout;

    /** The device's BD address (BLE MAC) — not a devices.id FK, so a device
     * can report OTA status before it's ever been claimed by a customer. */
    @Id
    @Column(name = "device_id", length = 17)
    private String device;

    @Column(nullable = false, length = 16)
    private String status = "pending";

    @Column(name = "reported_at")
    private Instant reportedAt;

    @Column(name = "error_detail")
    private String errorDetail;

    protected RolloutTarget() {
        // JPA
    }

    public RolloutTarget(UUID rollout, String device) {
        this.rollout = rollout;
        this.device = device;
    }

    public UUID getRollout() {
        return rollout;
    }

    public String getDevice() {
        return device;
    }

    public String getStatus() {
        return status;
    }

    public void report(String status, String errorDetail) {
        this.status = status;
        this.errorDetail = errorDetail;
        this.reportedAt = Instant.now();
    }

    public Instant getReportedAt() {
        return reportedAt;
    }

    public String getErrorDetail() {
        return errorDetail;
    }
}
