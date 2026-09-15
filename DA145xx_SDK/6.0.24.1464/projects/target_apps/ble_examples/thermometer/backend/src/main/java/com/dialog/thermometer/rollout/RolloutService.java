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

    /**
     * The rollout lifecycle vocabulary. {@code active} is the default a new
     * rollout is created with; {@code aborted} is what {@link #maybeAutoAbort}
     * sets when too many targets fail.
     */
    static final String STATUS_ACTIVE = "active";
    static final String STATUS_ABORTED = "aborted";

    /**
     * Per-device target statuses. {@code pending} is the row default;
     * {@code success} and {@code failed} are the only two values a collector may
     * report (see {@code RolloutStatusRequest}). Nothing writes "installed".
     */
    static final String TARGET_PENDING = "pending";
    static final String TARGET_FAILED = "failed";

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
     * success/failed for this device.
     *
     * <p>Status and chip model are narrowed by the database
     * ({@link RolloutRepository#findByStatusAndChipModelIgnoreCase}); only the
     * three conditions that aren't columns — deterministic target-group
     * bucketing, dotted-numeric version comparison, and this device's own
     * reported status — are evaluated here. This endpoint is polled by every
     * collector, so loading the table and filtering it in Java made its cost
     * scale with fleet size times poll rate.
     */
    public Optional<Rollout> findPending(String chipModel, String currentVersion, String deviceBdAddr) {
        return rollouts.findByStatusAndChipModelIgnoreCase(STATUS_ACTIVE, chipModel).stream()
                .filter(r -> isNewer(r.getVersion(), currentVersion))
                .filter(r -> isInTargetGroup(r, deviceBdAddr))
                .filter(r -> targets.findByRolloutAndDevice(r.getId(), deviceBdAddr)
                        .map(t -> TARGET_PENDING.equals(t.getStatus()))
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

    /**
     * Pauses the rollout once the error rate among devices that have reported so
     * far reaches its threshold — the only thing standing between a bad firmware
     * image and the whole fleet, so the arithmetic is worth being explicit
     * about:
     *
     * <ul>
     *   <li>the denominator is <b>devices that have reported</b>
     *   ({@code reportedAt != null}), not every target: a rollout whose devices
     *   have mostly not checked in yet must not look like a 0%-failure success
     *   <i>or</i> be aborted by two early failures out of a thousand pending
     *   targets;</li>
     *   <li>the comparison is {@code >=}, so a threshold of 20 aborts <i>at</i>
     *   20% and not only above it;</li>
     *   <li>integer division truncates, which rounds in the safe direction
     *   (1 of 3 failures is 33%, not 34%);</li>
     *   <li>only an {@code active} rollout changes state, so an already-aborted
     *   one is never rewritten and a manually-resumed one isn't re-aborted by a
     *   late straggler report.</li>
     * </ul>
     *
     * <p>Package-private rather than private so its threshold arithmetic is
     * unit-testable against mocked repositories without going through HTTP.
     */
    void maybeAutoAbort(java.util.UUID rolloutId) {
        List<RolloutTarget> reported = targets.findByRollout(rolloutId).stream()
                .filter(t -> t.getReportedAt() != null)
                .toList();
        if (reported.isEmpty()) {
            return;
        }
        long failed = reported.stream().filter(t -> TARGET_FAILED.equals(t.getStatus())).count();
        int errorPct = (int) (100 * failed / reported.size());

        rollouts.findById(rolloutId).ifPresent(rollout -> {
            if (errorPct >= rollout.getAbortThresholdPct() && STATUS_ACTIVE.equals(rollout.getStatus())) {
                rollout.setStatus(STATUS_ABORTED);
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
