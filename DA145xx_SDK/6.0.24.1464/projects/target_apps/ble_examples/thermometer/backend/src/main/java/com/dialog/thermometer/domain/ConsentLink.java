package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * FR-4: patient-initiated consent for a doctor to view a customer's device
 * data. Revocation is soft (revokedAt set, row kept) so history/audit is
 * never lost. "Active" means revokedAt == null.
 */
@Entity
@Table(name = "consent_links")
public class ConsentLink {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "patient_user_id", nullable = false, length = 64)
    private String patientUserId;

    @Column(name = "doctor_user_id", nullable = false, length = 64)
    private String doctorUserId;

    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt = Instant.now();

    @Column(name = "revoked_at")
    private Instant revokedAt;

    protected ConsentLink() {
        // JPA
    }

    public ConsentLink(String patientUserId, String doctorUserId) {
        this.patientUserId = patientUserId;
        this.doctorUserId = doctorUserId;
    }

    public UUID getId() {
        return id;
    }

    public String getPatientUserId() {
        return patientUserId;
    }

    public String getDoctorUserId() {
        return doctorUserId;
    }

    public Instant getGrantedAt() {
        return grantedAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public boolean isActive() {
        return revokedAt == null;
    }

    public void revoke() {
        this.revokedAt = Instant.now();
    }
}
