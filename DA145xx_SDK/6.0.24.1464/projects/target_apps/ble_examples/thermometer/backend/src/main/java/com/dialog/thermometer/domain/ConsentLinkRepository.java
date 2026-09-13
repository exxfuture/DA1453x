package com.dialog.thermometer.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ConsentLinkRepository extends JpaRepository<ConsentLink, UUID> {

    List<ConsentLink> findByPatientUserId(String patientUserId);

    List<ConsentLink> findByDoctorUserIdAndRevokedAtIsNull(String doctorUserId);

    Optional<ConsentLink> findByPatientUserIdAndDoctorUserIdAndRevokedAtIsNull(String patientUserId, String doctorUserId);

    /**
     * Owner-scoped lookup for revoke: a link that isn't this patient's simply
     * isn't found, so a non-owner gets 404 instead of a 403 that would confirm
     * the id exists. Same shape as {@code MeasurementAnnotationRepository
     * .findByIdAndUserId} / {@code CareNoteRepository.findByIdAndDoctorUserId}.
     */
    Optional<ConsentLink> findByIdAndPatientUserId(UUID id, String patientUserId);

    boolean existsByPatientUserIdAndDoctorUserIdAndRevokedAtIsNull(String patientUserId, String doctorUserId);

    /**
     * Every active link touching any of these users, from either side. Backs
     * the admin user list's per-user consent counts for one <i>page</i> of
     * users in a single query — the previous {@code findAll()}-and-group
     * approach read the whole table on every request.
     */
    @Query("""
            SELECT c FROM ConsentLink c
            WHERE c.revokedAt IS NULL
              AND (c.patientUserId IN :userIds OR c.doctorUserId IN :userIds)
            """)
    List<ConsentLink> findActiveInvolving(@Param("userIds") List<String> userIds);
}
