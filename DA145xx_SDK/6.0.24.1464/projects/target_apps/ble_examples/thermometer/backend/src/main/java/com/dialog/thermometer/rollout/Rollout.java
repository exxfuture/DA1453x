package com.dialog.thermometer.rollout;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * DIY firmware rollout, per architecture v3 §10: percentage-group targeting
 * with an abort threshold, no hawkBit dependency until rollout policy
 * genuinely outgrows this.
 */
@Entity
@Table(name = "rollouts")
public class Rollout {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 32)
    private String version;

    @Column(name = "chip_model", nullable = false, length = 32)
    private String chipModel;

    @Column(name = "image_url", nullable = false, length = 512)
    private String imageUrl;

    @Column(name = "delta_url", length = 512)
    private String deltaUrl;

    @Column(nullable = false, length = 64)
    private String sha256;

    @Column(nullable = false, length = 512)
    private String signature;

    @Column(name = "group_percentage", nullable = false)
    private int groupPercentage = 100;

    @Column(name = "abort_threshold_pct", nullable = false)
    private int abortThresholdPct = 20;

    @Column(nullable = false, length = 16)
    private String status = "active";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected Rollout() {
        // JPA
    }

    public Rollout(String version, String chipModel, String imageUrl, String deltaUrl,
                    String sha256, String signature, int groupPercentage, int abortThresholdPct) {
        this.version = version;
        this.chipModel = chipModel;
        this.imageUrl = imageUrl;
        this.deltaUrl = deltaUrl;
        this.sha256 = sha256;
        this.signature = signature;
        this.groupPercentage = groupPercentage;
        this.abortThresholdPct = abortThresholdPct;
    }

    public UUID getId() {
        return id;
    }

    public String getVersion() {
        return version;
    }

    public String getChipModel() {
        return chipModel;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public String getDeltaUrl() {
        return deltaUrl;
    }

    public String getSha256() {
        return sha256;
    }

    public String getSignature() {
        return signature;
    }

    public int getGroupPercentage() {
        return groupPercentage;
    }

    public int getAbortThresholdPct() {
        return abortThresholdPct;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
