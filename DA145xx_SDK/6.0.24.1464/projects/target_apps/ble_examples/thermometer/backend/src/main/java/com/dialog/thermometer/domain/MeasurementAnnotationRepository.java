package com.dialog.thermometer.domain;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MeasurementAnnotationRepository extends JpaRepository<MeasurementAnnotation, UUID> {

    List<MeasurementAnnotation> findByUserIdOrderByTsFromDesc(String userId);

    /** Chart overlay: the notes falling inside the window currently on screen. */
    List<MeasurementAnnotation> findByDeviceIdAndTsFromBetweenOrderByTsFromDesc(String deviceId, Instant from,
                                                                                 Instant to);

    /**
     * Same query with a caller-supplied cap, so the API's {@code limit}
     * becomes a real {@code LIMIT} instead of fetching everything and
     * trimming in Java. Pass an unsorted {@code PageRequest.of(0, limit)} —
     * the derived {@code OrderBy} still applies.
     */
    List<MeasurementAnnotation> findByDeviceIdAndTsFromBetweenOrderByTsFromDesc(String deviceId, Instant from,
                                                                                 Instant to, Pageable pageable);

    /** Ownership-scoped fetch: an edit/delete that isn't the author's simply finds nothing. */
    Optional<MeasurementAnnotation> findByIdAndUserId(UUID id, String userId);
}
