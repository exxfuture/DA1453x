package com.dialog.thermometer.domain;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;

/**
 * {@link JpaSpecificationExecutor} is here for the admin audit-log viewer,
 * whose filters (actor / action / subject / time range) are optional and
 * combine freely — a derived-query explosion otherwise.
 */
public interface AuditLogRepository extends JpaRepository<AuditLog, Long>, JpaSpecificationExecutor<AuditLog> {

    /** A user's own feed, narrowed to the actions a given role is allowed to see. */
    Page<AuditLog> findByActorIdAndActionInOrderByAtDesc(String actorId, List<String> actions, Pageable pageable);

    /**
     * Everything a user was involved in: entries they caused, plus entries
     * naming them as the subject (e.g. a consent granted <i>to</i> a doctor,
     * which the doctor never actioned themselves).
     */
    Page<AuditLog> findByActorIdOrSubjectOrderByAtDesc(String actorId, String subject, Pageable pageable);
}
