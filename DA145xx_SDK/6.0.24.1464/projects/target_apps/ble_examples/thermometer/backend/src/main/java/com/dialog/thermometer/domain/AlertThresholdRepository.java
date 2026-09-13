package com.dialog.thermometer.domain;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AlertThresholdRepository extends JpaRepository<AlertThreshold, UUID> {

    /**
     * Only meaningful for {@link AlertThreshold#SCOPE_SYSTEM}, the one scope
     * guaranteed single-rowed (ux_alert_thresholds_system). Calling it with
     * any other scope can match several rows and will throw.
     */
    Optional<AlertThreshold> findByScope(String scope);

    Optional<AlertThreshold> findByScopeAndSubjectUserId(String scope, String subjectUserId);

    Optional<AlertThreshold> findByScopeAndSubjectUserIdAndSetByUserId(String scope, String subjectUserId,
                                                                       String setByUserId);

    /** Batch form for AlertThresholdService.resolveBatch — one query for every subject at once. */
    List<AlertThreshold> findByScopeAndSubjectUserIdIn(String scope, List<String> subjectUserIds);

    /** Batch form of the doctor-override lookup: one doctor, many subjects, one query. */
    List<AlertThreshold> findByScopeAndSetByUserIdAndSubjectUserIdIn(String scope, String setByUserId,
                                                                     List<String> subjectUserIds);
}
