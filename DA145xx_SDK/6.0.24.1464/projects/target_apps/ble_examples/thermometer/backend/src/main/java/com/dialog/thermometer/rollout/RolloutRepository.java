package com.dialog.thermometer.rollout;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface RolloutRepository extends JpaRepository<Rollout, UUID> {
}
