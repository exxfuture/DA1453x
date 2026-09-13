package com.dialog.thermometer.rollout;

import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RolloutServiceTest {

    private final RolloutService service =
            new RolloutService(Mockito.mock(RolloutRepository.class), Mockito.mock(RolloutTargetRepository.class));

    @Test
    void bucketingIsDeterministicForTheSameRolloutAndDevice() {
        UUID rolloutId = UUID.randomUUID();
        int first = RolloutService.bucketOf(rolloutId, "AA:BB:CC:DD:EE:FF");
        int second = RolloutService.bucketOf(rolloutId, "AA:BB:CC:DD:EE:FF");
        assertEquals(first, second, "same rollout+device must always land in the same bucket");
    }

    @RepeatedTest(20)
    void bucketIsAlwaysAPercentage() {
        int bucket = RolloutService.bucketOf(UUID.randomUUID(), "11:22:33:44:55:66");
        assertTrue(bucket >= 0 && bucket < 100);
    }

    @Test
    void growingGroupPercentageOnlyEverAddsDevicesNeverRemoves() {
        UUID rolloutId = UUID.randomUUID();
        String[] devices = {"AA:AA:AA:AA:AA:01", "AA:AA:AA:AA:AA:02", "AA:AA:AA:AA:AA:03", "AA:AA:AA:AA:AA:04"};

        java.util.Set<String> in10pct = new java.util.HashSet<>();
        java.util.Set<String> in50pct = new java.util.HashSet<>();
        for (String device : devices) {
            int bucket = RolloutService.bucketOf(rolloutId, device);
            if (bucket < 10) in10pct.add(device);
            if (bucket < 50) in50pct.add(device);
        }
        assertTrue(in50pct.containsAll(in10pct), "everyone in the 10% group must still be in the 50% group");
    }

    @Test
    void newerVersionBeatsOlder() {
        assertTrue(service.isNewer("1.4.0", "1.3.2"));
        assertFalse(service.isNewer("1.3.2", "1.4.0"));
        assertFalse(service.isNewer("1.3.2", "1.3.2"));
    }

    @Test
    void deviceWithNoReportedVersionIsAlwaysEligible() {
        assertTrue(service.isNewer("1.0.0", null));
        assertTrue(service.isNewer("1.0.0", ""));
    }

    @Test
    void versionCompareHandlesDifferentSegmentCounts() {
        assertTrue(service.isNewer("1.4", "1.3.9"));
        assertTrue(service.isNewer("2.0.0", "1.99.99"));
    }
}
