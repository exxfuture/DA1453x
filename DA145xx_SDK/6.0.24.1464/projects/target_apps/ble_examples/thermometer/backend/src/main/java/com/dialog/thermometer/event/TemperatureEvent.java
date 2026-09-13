package com.dialog.thermometer.event;

import java.time.Instant;

/**
 * One detected fever "episode": a run of consecutive readings from a device
 * that stayed at or above the elevated tier, summarised by its worst tier and
 * peak value. Derived on read from the measurements hypertable — deliberately
 * not a stored table, so changing a patient's thresholds retroactively
 * re-describes their history instead of leaving stale rows behind.
 *
 * @param tier         worst tier reached during the episode ("elevated", "fever", "highFever")
 * @param peakCelsius  highest reading in the episode
 * @param readingCount how many readings the episode spans
 */
public record TemperatureEvent(String deviceBdAddr, String tier, Instant startTs, Instant endTs, double peakCelsius,
                                int readingCount) {
}
