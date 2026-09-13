package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * A doctor's clinical note about one patient. Doctor-private: only its author
 * reads or writes it, with an admin-only read path for compliance — see
 * V1__init.sql.
 */
@Entity
@Table(name = "care_notes")
public class CareNote {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "doctor_user_id", nullable = false, length = 64)
    private String doctorUserId;

    @Column(name = "patient_user_id", nullable = false, length = 64)
    private String patientUserId;

    @Column(nullable = false)
    private String note;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected CareNote() {
        // JPA
    }

    public CareNote(String doctorUserId, String patientUserId, String note) {
        this.doctorUserId = doctorUserId;
        this.patientUserId = patientUserId;
        this.note = note;
    }

    public UUID getId() {
        return id;
    }

    public String getDoctorUserId() {
        return doctorUserId;
    }

    public String getPatientUserId() {
        return patientUserId;
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

    public void edit(String note) {
        this.note = note;
        this.updatedAt = Instant.now();
    }
}
