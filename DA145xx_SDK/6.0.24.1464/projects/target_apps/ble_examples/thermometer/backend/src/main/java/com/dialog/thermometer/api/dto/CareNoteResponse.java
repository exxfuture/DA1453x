package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.CareNote;

import java.time.Instant;
import java.util.UUID;

/**
 * A doctor's clinical note. Doctor-private: only its author reads it through
 * the doctor API, with an admin-only compliance read in AdminController —
 * there is no patient-facing path (see V1__init.sql).
 */
public record CareNoteResponse(
        UUID id,
        String doctorUserId,
        String doctorUsername,
        String patientUserId,
        String patientUsername,
        String note,
        Instant createdAt,
        Instant updatedAt) {

    public static CareNoteResponse from(CareNote note) {
        return from(note, null, null);
    }

    /** Usernames are resolved separately — CareNote holds ids only, no relations. */
    public static CareNoteResponse from(CareNote note, String doctorUsername, String patientUsername) {
        return new CareNoteResponse(
                note.getId(),
                note.getDoctorUserId(),
                doctorUsername,
                note.getPatientUserId(),
                patientUsername,
                note.getNote(),
                note.getCreatedAt(),
                note.getUpdatedAt());
    }
}
