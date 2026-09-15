package com.dialog.thermometer.rollout;

import com.dialog.thermometer.api.dto.RolloutStatusRequest;
import com.dialog.thermometer.api.dto.RolloutSummaryResponse;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the rollout status vocabulary on the wire.
 *
 * <p>Three comments in this codebase used to describe it as
 * {@code pending/installed/failed} while the API validated
 * {@code success|failed} and nothing ever wrote "installed" — either stale docs
 * or, if a frontend keyed an "installed" bucket on it, a real bug in a
 * permanently-empty column. No test asserted the key names, so nothing would
 * have caught it. This one does, from both ends: what the API accepts, and what
 * {@code statusCounts} is keyed by.
 */
class RolloutSummaryResponseTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    private static Rollout rollout() {
        return new Rollout("1.4.0", "DA14535", "https://minio/fw.img", null, "sha", "sig", 100, 20);
    }

    @Test
    void statusCountsAreKeyedByExactlyPendingSuccessAndFailed() {
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("pending", 7L);
        counts.put("success", 12L);
        counts.put("failed", 1L);

        RolloutSummaryResponse response = RolloutSummaryResponse.from(rollout(), counts);

        assertEquals(Map.of("pending", 7L, "success", 12L, "failed", 1L), response.statusCounts(),
                "the keys are the raw rollout_targets.status values and must pass through untranslated");
        assertFalse(response.statusCounts().containsKey("installed"),
                "there is no 'installed' status — nothing writes it, so no client may key on it");
        assertEquals(20, response.targetCount(), "targetCount is the sum of the per-status counts");
    }

    /** A rollout nobody has reported on has an empty map, not three zeroes — clients must treat absent as 0. */
    @Test
    void unreportedRolloutHasAnEmptyStatusMap() {
        assertEquals(Map.of(), RolloutSummaryResponse.from(rollout(), null).statusCounts());
        assertEquals(0, RolloutSummaryResponse.from(rollout(), null).targetCount());
    }

    @Test
    void theApiAcceptsOnlyTheStatusesTheCountsAreKeyedBy() {
        assertTrue(validator.validate(new RolloutStatusRequest("AA:BB:CC:DD:EE:FF", "success", null)).isEmpty());
        assertTrue(validator.validate(new RolloutStatusRequest("AA:BB:CC:DD:EE:FF", "failed", null)).isEmpty());
        assertFalse(validator.validate(new RolloutStatusRequest("AA:BB:CC:DD:EE:FF", "installed", null)).isEmpty(),
                "'installed' is not part of the vocabulary and must be rejected, not silently stored");
        assertFalse(validator.validate(new RolloutStatusRequest("AA:BB:CC:DD:EE:FF", "pending", null)).isEmpty(),
                "'pending' is the row default, not something a collector reports");
    }
}
