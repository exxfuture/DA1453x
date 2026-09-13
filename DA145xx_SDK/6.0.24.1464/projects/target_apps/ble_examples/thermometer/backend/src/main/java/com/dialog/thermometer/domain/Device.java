package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * Registry row for one physical thermometer. Claiming (setting ownerUserId)
 * happens the first time a collector connects the device to a logged-in
 * user's account — see DeviceController.
 */
@Entity
@Table(name = "devices")
public class Device {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "bd_addr", nullable = false, unique = true, length = 17)
    private String bdAddr;

    @Column(nullable = false, length = 64)
    private String model;

    @Column(name = "fw_version", length = 32)
    private String fwVersion;

    /** Customer-set friendly name ("Baby's thermometer"); null = unnamed. */
    @Column(length = 64)
    private String label;

    @Column(name = "owner_user_id", length = 64)
    private String ownerUserId;

    @Column(name = "claimed_at")
    private Instant claimedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    /** Timestamp of the newest reading ingested for this device — see {@link #recordSeen}. */
    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    /** Measurement type of that reading (temperature/humidity/battery). */
    @Column(name = "last_seen_type", length = 32)
    private String lastSeenType;

    protected Device() {
        // JPA
    }

    public Device(String bdAddr, String model, String fwVersion) {
        this.bdAddr = bdAddr;
        this.model = model;
        this.fwVersion = fwVersion;
    }

    public UUID getId() {
        return id;
    }

    public String getBdAddr() {
        return bdAddr;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getFwVersion() {
        return fwVersion;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public void setFwVersion(String fwVersion) {
        this.fwVersion = fwVersion;
    }

    public String getOwnerUserId() {
        return ownerUserId;
    }

    public Instant getClaimedAt() {
        return claimedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public String getLastSeenType() {
        return lastSeenType;
    }

    /**
     * Records that a reading arrived, denormalising what staleness views
     * would otherwise have to dig out of the measurements hypertable per
     * device (V1__init.sql).
     *
     * <p>Only ever moves forward: readings can arrive out of order (a
     * collector flushing a backlog after being offline), and "last seen"
     * jumping backwards would make a live device look stale.
     *
     * <p>The ingest hot path does not go through here — it issues a targeted
     * conditional UPDATE instead (see
     * {@code MeasurementIngestService.recordLastSeen}), because merging a
     * whole detached Device back would race with concurrent claim/edit
     * writes. This mutator is for callers that already hold a managed entity.
     *
     * @return true if this call advanced the timestamp, i.e. a save is worth doing
     */
    public boolean recordSeen(Instant ts, String type) {
        if (ts == null || (lastSeenAt != null && !ts.isAfter(lastSeenAt))) {
            return false;
        }
        this.lastSeenAt = ts;
        this.lastSeenType = type;
        return true;
    }

    public void claim(String userId) {
        this.ownerUserId = userId;
        this.claimedAt = Instant.now();
    }

    public void release() {
        this.ownerUserId = null;
        this.claimedAt = null;
    }
}
