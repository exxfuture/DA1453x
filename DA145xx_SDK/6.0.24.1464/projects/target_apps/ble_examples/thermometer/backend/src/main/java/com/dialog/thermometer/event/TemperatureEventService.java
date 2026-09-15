package com.dialog.thermometer.event;

import com.dialog.thermometer.threshold.AlertThresholdService;
import com.dialog.thermometer.threshold.AlertThresholdService.ResolvedThresholds;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Turns raw readings into fever episodes, against whatever thresholds apply
 * to the person the device belongs to (see {@link AlertThresholdService}).
 *
 * <p>Raw SQL against {@code measurements} rather than JPA, matching
 * MeasurementController/ConsentController: the hypertable has no entity and
 * these are read-only, index-shaped queries.
 *
 * <p><b>MVP simplification:</b> an episode is a maximal run of
 * <i>consecutive</i> readings at or above the elevated tier. A single
 * below-threshold reading in the middle — a dip, or one bad contact — splits
 * one clinical fever into two reported episodes. Gap/dip merging (e.g. "still
 * the same episode if it recovers for under 30 minutes") is deliberately not
 * implemented until there's real data to calibrate the window against;
 * everything needed for it is in the readings this already loads.
 */
@Service
public class TemperatureEventService {

    /**
     * Hard ceiling on rows pulled into memory per call. At the firmware's
     * ~1 reading/minute this is ~2 weeks for a single device — well past any
     * range the UI asks for, but it stops an unbounded {@code from}/{@code to}
     * from turning a hypertable scan into an OOM.
     */
    private static final int MAX_READINGS = 20_000;

    /**
     * The severity an episode starts at. Ranked through
     * {@link AlertThresholdService#tierRank} rather than against a local copy of
     * the tier list: a second copy compiles and passes its tests after a tier is
     * renamed on one side only, silently desynchronising episode detection from
     * threshold resolution.
     */
    private static final int ELEVATED_RANK = AlertThresholdService.tierRank("elevated");

    private final JdbcTemplate jdbcTemplate;
    private final AlertThresholdService alertThresholds;

    public TemperatureEventService(JdbcTemplate jdbcTemplate, AlertThresholdService alertThresholds) {
        this.jdbcTemplate = jdbcTemplate;
        this.alertThresholds = alertThresholds;
    }

    /** Episodes for one device in one window, newest-last (chronological). */
    public List<TemperatureEvent> detect(String bdAddr, Instant from, Instant to, ResolvedThresholds thresholds) {
        List<Reading> readings = jdbcTemplate.query("""
                        SELECT ts, value_num
                        FROM measurements
                        WHERE device_id = ? AND type = 'temperature' AND value_num IS NOT NULL
                          AND ts BETWEEN ? AND ?
                        ORDER BY ts
                        LIMIT ?
                        """,
                (rs, rowNum) -> new Reading(rs.getTimestamp("ts").toInstant(), rs.getDouble("value_num")),
                bdAddr, Timestamp.from(from), Timestamp.from(to), MAX_READINGS);

        return episodesOf(bdAddr, readings, thresholds);
    }

    /**
     * Episodes for a whole fleet in <b>one</b> query — the doctor dashboard
     * renders every consenting patient at once, so this must not grow a round
     * trip per device. Devices with no readings in the window are present in
     * the result with an empty list.
     *
     * @param thresholdsByBdAddr per-device scale; a device missing from the map
     *                           falls back to {@link AlertThresholdService#FALLBACK}
     */
    public Map<String, List<TemperatureEvent>> detectBatch(List<String> bdAddrs, Instant from, Instant to,
                                                            Map<String, ResolvedThresholds> thresholdsByBdAddr) {
        List<String> devices = bdAddrs == null ? List.of()
                : bdAddrs.stream().filter(Objects::nonNull).distinct().toList();
        if (devices.isEmpty()) {
            return Map.of();
        }

        String placeholders = devices.stream().map(d -> "?").collect(Collectors.joining(", "));
        Object[] args = new Object[devices.size() + 3];
        for (int i = 0; i < devices.size(); i++) {
            args[i] = devices.get(i);
        }
        args[devices.size()] = Timestamp.from(from);
        args[devices.size() + 1] = Timestamp.from(to);
        args[devices.size() + 2] = MAX_READINGS;

        // Placeholders are generated from the device count only; every value,
        // including the BD addresses, is still bound as a parameter.
        List<DeviceReading> rows = jdbcTemplate.query("""
                        SELECT device_id, ts, value_num
                        FROM measurements
                        WHERE device_id IN (%s) AND type = 'temperature' AND value_num IS NOT NULL
                          AND ts BETWEEN ? AND ?
                        ORDER BY device_id, ts
                        LIMIT ?
                        """.formatted(placeholders),
                (rs, rowNum) -> new DeviceReading(rs.getString("device_id"),
                        new Reading(rs.getTimestamp("ts").toInstant(), rs.getDouble("value_num"))),
                args);

        Map<String, List<Reading>> readingsByDevice = new LinkedHashMap<>();
        devices.forEach(d -> readingsByDevice.put(d, new ArrayList<>()));
        rows.forEach(row -> readingsByDevice.get(row.deviceId()).add(row.reading()));

        Map<String, List<TemperatureEvent>> eventsByDevice = new LinkedHashMap<>(devices.size());
        readingsByDevice.forEach((bdAddr, readings) -> eventsByDevice.put(bdAddr, episodesOf(bdAddr, readings,
                thresholdsByBdAddr.getOrDefault(bdAddr, AlertThresholdService.FALLBACK))));
        return eventsByDevice;
    }

    /**
     * Groups a chronologically ordered reading list into maximal consecutive
     * runs at or above the elevated tier. Pure function of its inputs — the
     * part worth unit-testing, no database involved.
     */
    private List<TemperatureEvent> episodesOf(String bdAddr, List<Reading> readings, ResolvedThresholds thresholds) {
        List<TemperatureEvent> events = new ArrayList<>();
        Episode current = null;

        for (Reading reading : readings) {
            String tier = alertThresholds.tierOf(reading.celsius(), thresholds);
            if (AlertThresholdService.tierRank(tier) < ELEVATED_RANK) {
                if (current != null) {
                    events.add(current.toEvent(bdAddr));
                    current = null;
                }
                continue;
            }
            if (current == null) {
                current = new Episode(reading.ts());
            }
            current.extend(reading, tier);
        }
        if (current != null) {
            events.add(current.toEvent(bdAddr));
        }
        return events;
    }

    private record Reading(Instant ts, double celsius) {
    }

    private record DeviceReading(String deviceId, Reading reading) {
    }

    /** Mutable accumulator for the run being walked; never escapes this class. */
    private static final class Episode {
        private final Instant startTs;
        private Instant endTs;
        private double peakCelsius = Double.NEGATIVE_INFINITY;
        private String worstTier = "elevated";
        private int readingCount;

        private Episode(Instant startTs) {
            this.startTs = startTs;
        }

        private void extend(Reading reading, String tier) {
            endTs = reading.ts();
            readingCount++;
            if (reading.celsius() > peakCelsius) {
                peakCelsius = reading.celsius();
            }
            if (AlertThresholdService.tierRank(tier) > AlertThresholdService.tierRank(worstTier)) {
                worstTier = tier;
            }
        }

        private TemperatureEvent toEvent(String bdAddr) {
            return new TemperatureEvent(bdAddr, worstTier, startTs, endTs, peakCelsius, readingCount);
        }
    }
}
