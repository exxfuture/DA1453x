package com.dialog.thermometer.rollout;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Auto-abort is the only thing between a bad firmware image and 100% of the
 * fleet, and its threshold arithmetic had no coverage at all —
 * {@code RolloutServiceTest} exercises bucketing and version comparison but
 * never {@code reportStatus}. Driven through {@link RolloutService#reportStatus}
 * (the real entry point, called by the collector endpoint) with mocked
 * repositories, so both the status write and the abort decision are covered.
 */
class RolloutAutoAbortTest {

    private final RolloutRepository rollouts = Mockito.mock(RolloutRepository.class);
    private final RolloutTargetRepository targets = Mockito.mock(RolloutTargetRepository.class);
    private final RolloutService service = new RolloutService(rollouts, targets);

    private final UUID rolloutId = UUID.randomUUID();

    private static Rollout rollout(int abortThresholdPct) {
        return new Rollout("1.4.0", "DA14535", "https://minio/fw.img", null, "sha", "sig", 100, abortThresholdPct);
    }

    private RolloutTarget reported(String device, String status) {
        RolloutTarget target = new RolloutTarget(rolloutId, device);
        target.report(status, null);
        return target;
    }

    /** Never reported: no {@code reportedAt}, so it is not part of the error rate. */
    private RolloutTarget pending(String device) {
        return new RolloutTarget(rolloutId, device);
    }

    private void given(Rollout rollout, List<RolloutTarget> targetRows) {
        when(rollouts.findById(rolloutId)).thenReturn(Optional.of(rollout));
        when(targets.findByRollout(rolloutId)).thenReturn(targetRows);
        when(targets.findByRolloutAndDevice(any(), any())).thenReturn(Optional.empty());
    }

    @Test
    void abortsExactlyAtTheThreshold() {
        Rollout rollout = rollout(20);
        // 1 failure out of 5 reported = 20%, i.e. the threshold itself: the
        // comparison is >=, so this must abort rather than squeeze under it.
        given(rollout, List.of(reported("AA:00", "failed"), reported("AA:01", "success"),
                reported("AA:02", "success"), reported("AA:03", "success"), reported("AA:04", "success")));

        service.reportStatus(rolloutId, "AA:00", "failed", "flash write error");

        assertEquals("aborted", rollout.getStatus());
        verify(rollouts).save(rollout);
    }

    @Test
    void abortsAboveTheThreshold() {
        Rollout rollout = rollout(20);
        given(rollout, List.of(reported("AA:00", "failed"), reported("AA:01", "failed"),
                reported("AA:02", "success")));

        service.reportStatus(rolloutId, "AA:01", "failed", null);

        assertEquals("aborted", rollout.getStatus());
    }

    @Test
    void doesNotAbortBelowTheThreshold() {
        Rollout rollout = rollout(20);
        // 1 of 10 = 10%; integer division truncates, which must not round up.
        List<RolloutTarget> reportedRows = new java.util.ArrayList<>(List.of(reported("AA:00", "failed")));
        for (int i = 1; i < 10; i++) {
            reportedRows.add(reported("AA:0" + i, "success"));
        }
        given(rollout, reportedRows);

        service.reportStatus(rolloutId, "AA:00", "failed", null);

        assertEquals("active", rollout.getStatus());
        verify(rollouts, never()).save(any());
    }

    /**
     * The denominator is devices that have <i>reported</i>, not every target —
     * otherwise a large rollout could never trip its threshold early (two
     * failures out of a thousand mostly-pending targets is 0%), and a rollout
     * nobody has answered yet would look like a success.
     */
    @Test
    void countsOnlyDevicesThatHaveReported() {
        Rollout rollout = rollout(50);
        given(rollout, List.of(reported("AA:00", "failed"), reported("AA:01", "success"),
                pending("AA:02"), pending("AA:03"), pending("AA:04"), pending("AA:05")));

        service.reportStatus(rolloutId, "AA:00", "failed", null);

        // 1 failure of 2 reported = 50% → aborts, even though it is 1 of 6 targets.
        assertEquals("aborted", rollout.getStatus());
    }

    @Test
    void doesNothingWhenNobodyHasReportedYet() {
        Rollout rollout = rollout(1);
        given(rollout, List.of(pending("AA:00"), pending("AA:01")));

        service.maybeAutoAbort(rolloutId);

        assertEquals("active", rollout.getStatus());
        verify(rollouts, never()).save(any());
    }

    /** An already-aborted rollout is never rewritten by a late straggler report. */
    @Test
    void leavesAnAlreadyAbortedRolloutAlone() {
        Rollout rollout = rollout(20);
        rollout.setStatus("aborted");
        given(rollout, List.of(reported("AA:00", "failed")));

        service.maybeAutoAbort(rolloutId);

        verify(rollouts, never()).save(any());
    }

    @Test
    void reportStatusPersistsTheDevicesOwnOutcomeBeforeDeciding() {
        Rollout rollout = rollout(90);
        given(rollout, List.of(reported("AA:00", "success")));

        service.reportStatus(rolloutId, "AA:00", "success", null);

        ArgumentCaptor<RolloutTarget> saved = ArgumentCaptor.forClass(RolloutTarget.class);
        verify(targets, times(1)).save(saved.capture());
        assertEquals("success", saved.getValue().getStatus(),
                "'success' and 'failed' are the only statuses a collector may report");
        assertFalse(rollout.getStatus().equals("aborted"));
    }
}
