package com.dialog.thermometer.domain;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CareNoteRepository extends JpaRepository<CareNote, UUID> {

    List<CareNote> findByDoctorUserIdAndPatientUserIdOrderByCreatedAtDesc(String doctorUserId, String patientUserId);

    /** Authorship-scoped fetch: another doctor's note simply isn't found. */
    Optional<CareNote> findByIdAndDoctorUserId(UUID id, String doctorUserId);

    /** Admin-only compliance read — every doctor's notes about one patient. */
    List<CareNote> findByPatientUserIdOrderByCreatedAtDesc(String patientUserId);
}
