package com.dialog.thermometer.rollout;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class RolloutTargetId implements Serializable {

    private UUID rollout;
    private String device;

    public RolloutTargetId() {
        // JPA
    }

    public RolloutTargetId(UUID rollout, String device) {
        this.rollout = rollout;
        this.device = device;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof RolloutTargetId that)) return false;
        return Objects.equals(rollout, that.rollout) && Objects.equals(device, that.device);
    }

    @Override
    public int hashCode() {
        return Objects.hash(rollout, device);
    }
}
