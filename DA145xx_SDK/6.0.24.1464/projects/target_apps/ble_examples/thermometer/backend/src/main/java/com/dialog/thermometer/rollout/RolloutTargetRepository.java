package com.dialog.thermometer.rollout;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RolloutTargetRepository extends JpaRepository<RolloutTarget, RolloutTargetId> {

    List<RolloutTarget> findByRollout(UUID rollout);

    Optional<RolloutTarget> findByRolloutAndDevice(UUID rollout, String device);

    /** One (rollout, status) tally — see {@link #countByStatusForRollouts}. */
    interface RolloutStatusCount {
        UUID getRollout();

        String getStatus();

        long getCount();
    }

    /**
     * Progress for a page of rollouts in a single query: one count per
     * {@code (rollout, status)} pair for every listed rollout at once, so the
     * admin list never degrades into one count query per row.
     *
     * <p>The status vocabulary is {@code pending} (the row's default, written
     * when a rollout targets a device) and {@code success}/{@code failed} (what a
     * collector reports — the only two values
     * {@code RolloutStatusRequest.status} accepts). There is no
     * {@code installed}: an earlier draft of this comment said so, but nothing
     * ever wrote it, and {@code RolloutSummaryResponse.statusCounts} is keyed by
     * exactly these strings.
     */
    @Query("""
            SELECT t.rollout AS rollout, t.status AS status, COUNT(t) AS count
            FROM RolloutTarget t
            WHERE t.rollout IN :rolloutIds
            GROUP BY t.rollout, t.status
            """)
    List<RolloutStatusCount> countByStatusForRollouts(@Param("rolloutIds") List<UUID> rolloutIds);
}
