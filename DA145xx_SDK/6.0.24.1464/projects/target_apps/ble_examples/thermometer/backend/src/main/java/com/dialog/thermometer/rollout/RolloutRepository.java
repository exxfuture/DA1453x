package com.dialog.thermometer.rollout;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface RolloutRepository extends JpaRepository<Rollout, UUID> {

    /**
     * Candidate rollouts for one collector check-in. Narrowing in SQL matters
     * here more than anywhere else in the codebase: {@code GET
     * /api/rollouts/pending} is polled by every collector, and the previous
     * {@code findAll()} + Java-side filter pulled the whole table into memory
     * once per poll — cost scaling with fleet size × poll rate. Status and chip
     * model are the two selective predicates; the remaining conditions (target
     * group, version comparison, per-device status) are computed, not
     * expressible as columns.
     */
    List<Rollout> findByStatusAndChipModelIgnoreCase(String status, String chipModel);
}
