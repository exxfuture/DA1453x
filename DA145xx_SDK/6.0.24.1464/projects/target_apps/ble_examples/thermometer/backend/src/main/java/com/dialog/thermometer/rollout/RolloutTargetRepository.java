package com.dialog.thermometer.rollout;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RolloutTargetRepository extends JpaRepository<RolloutTarget, RolloutTargetId> {

    List<RolloutTarget> findByDevice(String device);

    List<RolloutTarget> findByRollout(UUID rollout);

    Optional<RolloutTarget> findByRolloutAndDevice(UUID rollout, String device);

    /** One (rollout, status) tally — see {@link #countByStatusForRollouts}. */
    interface RolloutStatusCount {
        UUID getRollout();

        String getStatus();

        long getCount();
    }

    /**
     * Progress for a page of rollouts in a single query: pending/installed/
     * failed counts for every listed rollout at once, so the admin list never
     * degrades into one count query per row.
     */
    @Query("""
            SELECT t.rollout AS rollout, t.status AS status, COUNT(t) AS count
            FROM RolloutTarget t
            WHERE t.rollout IN :rolloutIds
            GROUP BY t.rollout, t.status
            """)
    List<RolloutStatusCount> countByStatusForRollouts(@Param("rolloutIds") List<UUID> rolloutIds);
}
