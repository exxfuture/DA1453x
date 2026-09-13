package com.dialog.thermometer.rollout;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * DIY rollout targeting (architecture v3 §10): percentage-group canary
 * rollout with an abort threshold, implemented as a couple of tables and
 * this class instead of standing up hawkBit. Adopt hawkBit only when this
 * stops being enough — see ARCHITECTURE_V3.html §15.
 */
@Service
public class RolloutService {

    private final RolloutRepository rollouts;
    private final RolloutTargetRepository targets;

    public RolloutService(RolloutRepository rollouts, RolloutTargetRepository targets) {
        this.rollouts = rollouts;
        this.targets = targets;
    }

    public Rollout create(Rollout rollout) {
        return rollouts.save(rollout);
    }

    /** Newest first unless the caller asked for a different order. */
    public Page<Rollout> list(Pageable pageable) {
        Pageable effective = pageable.getSort().isSorted()
                ? pageable
                : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                        Sort.by(Sort.Direction.DESC, "createdAt"));
        return rollouts.findAll(effective);
    }

    public Optional<Rollout> find(UUID rolloutId) {
        return rollouts.findById(rolloutId);
    }

    public List<RolloutTarget> targetsOf(UUID rolloutId) {
        return targets.findByRollout(rolloutId);
    }

    /**
     * Per-status target tallies for many rollouts in one grouped query, keyed
     * by rollout id. The admin list renders a progress bar per row, so the
     * obvious per-row {@code countByRolloutAndStatus} would be an N+1 that
     * grows with the page size.
     */
    public Map<UUID, Map<String, Long>> progressOf(List<UUID> rolloutIds) {
        if (rolloutIds == null || rolloutIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Map<String, Long>> byRollout = new HashMap<>(rolloutIds.size());
        for (RolloutTargetRepository.RolloutStatusCount row : targets.countByStatusForRollouts(rolloutIds)) {
            byRollout.computeIfAbsent(row.getRollout(), id -> new HashMap<>()).put(row.getStatus(), row.getCount());
        }
        return byRollout;
    }

    /**
     * Deterministic percentage bucketing: the same device always lands in
     * the same bucket for a given rollout, so growing a rollout from 10% to
     * 100% only ever adds devices, never reshuffles who already got it.
     */
    public boolean isInTargetGroup(Rollout rollout, String deviceBdAddr) {
        return bucketOf(rollout.getId(), deviceBdAddr) < rollout.getGroupPercentage();
    }

    // package-private, pure function, unit-testable without a persisted Rollout
    static int bucketOf(java.util.UUID rolloutId, String deviceBdAddr) {
        return Math.floorMod((rolloutId.toString() + deviceBdAddr).hashCode(), 100);
    }

    /**
     * The rollout a collector should offer to a device, if any: active,
     * matches chip model, device is in the current target group, newer than
     * the device's reported firmware version, and not already reported as
     * installed/failed for this device.
     */
    public Optional<Rollout> findPending(String chipModel, String currentVersion, String deviceBdAddr) {
        return rollouts.findAll().stream()
                .filter(r -> "active".equals(r.getStatus()))
                .filter(r -> r.getChipModel().equalsIgnoreCase(chipModel))
                .filter(r -> isNewer(r.getVersion(), currentVersion))
                .filter(r -> isInTargetGroup(r, deviceBdAddr))
                .filter(r -> targets.findByRolloutAndDevice(r.getId(), deviceBdAddr)
                        .map(t -> "pending".equals(t.getStatus()))
                        .orElse(true))
                .findFirst();
    }

    public void reportStatus(java.util.UUID rolloutId, String deviceBdAddr, String status, String errorDetail) {
        RolloutTarget target = targets.findByRolloutAndDevice(rolloutId, deviceBdAddr)
                .orElseGet(() -> new RolloutTarget(rolloutId, deviceBdAddr));
        target.report(status, errorDetail);
        targets.save(target);
        maybeAutoAbort(rolloutId);
    }

    /** Pauses the rollout if the error rate among devices that have reported so far exceeds its threshold. */
    private void maybeAutoAbort(java.util.UUID rolloutId) {
        List<RolloutTarget> reported = targets.findByRollout(rolloutId).stream()
                .filter(t -> t.getReportedAt() != null)
                .toList();
        if (reported.isEmpty()) {
            return;
        }
        long failed = reported.stream().filter(t -> "failed".equals(t.getStatus())).count();
        int errorPct = (int) (100 * failed / reported.size());

        rollouts.findById(rolloutId).ifPresent(rollout -> {
            if (errorPct >= rollout.getAbortThresholdPct() && "active".equals(rollout.getStatus())) {
                rollout.setStatus("aborted");
                rollouts.save(rollout);
            }
        });
    }

    // package-private for direct unit testing without mocking the repositories
    boolean isNewer(String candidate, String current) {
        if (current == null || current.isBlank()) {
            return true;
        }
        return compareVersions(candidate, current) > 0;
    }

    /** Simple dotted-numeric version compare (e.g. "1.4.0" > "1.3.2"); non-numeric segments compare as equal. */
    private int compareVersions(String a, String b) {
        String[] partsA = a.split("\\.");
        String[] partsB = b.split("\\.");
        int len = Math.max(partsA.length, partsB.length);
        for (int i = 0; i < len; i++) {
            int va = i < partsA.length ? parseIntSafe(partsA[i]) : 0;
            int vb = i < partsB.length ? parseIntSafe(partsB[i]) : 0;
            if (va != vb) {
                return Integer.compare(va, vb);
            }
        }
        return 0;
    }

    private int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
