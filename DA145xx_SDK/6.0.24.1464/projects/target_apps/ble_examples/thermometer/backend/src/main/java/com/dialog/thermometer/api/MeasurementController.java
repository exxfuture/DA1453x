package com.dialog.thermometer.api;

import com.dialog.thermometer.api.dto.MeasurementResponse;
import com.dialog.thermometer.ingest.MeasurementEnvelope;
import com.dialog.thermometer.ingest.MeasurementIngestService;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.DeviceAccessGuard;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

/**
 * REST fallback upload path (architecture v2 §5.2 — "MQTT over WebSocket or
 * plain HTTPS batch POST as fallback") and the history query the web/mobile
 * dashboards read from. The live feed (architecture v3 §7) is NOT here — it
 * goes straight from collector/browser to the broker over MQTT/WSS.
 *
 * <p>Both endpoints are authorized against the caller's identity, by
 * {@link DeviceAccessGuard}: reads follow the ownership/consent rule shared
 * with events and annotations, writes follow the stricter owner-only ingest
 * rule. The upload path is authenticated as a <i>person</i> because that is
 * who calls it — the browser collector in {@code fe/src/pages/ConnectPage.tsx}
 * uploading its own Web Bluetooth readings — unlike the OTA collector
 * endpoints in {@link RolloutController}, which have no user behind them and
 * use a shared {@code X-Device-Token} instead.
 */
@RestController
@RequestMapping("/api/measurements")
public class MeasurementController {

    private final MeasurementIngestService ingestService;
    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final DeviceAccessGuard accessGuard;

    public MeasurementController(MeasurementIngestService ingestService, JdbcTemplate jdbcTemplate,
                                  CurrentUserService currentUserService, DeviceAccessGuard accessGuard) {
        this.ingestService = ingestService;
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.accessGuard = accessGuard;
    }

    @PostMapping
    public ResponseEntity<Void> ingest(@Valid @RequestBody MeasurementEnvelope envelope,
                                        Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        accessGuard.requireIngestAccess(me, envelope.deviceId());

        boolean inserted = ingestService.ingest(envelope);
        return inserted ? ResponseEntity.status(201).build() : ResponseEntity.ok().build();
    }

    @GetMapping("/{deviceId}")
    public List<MeasurementResponse> history(@PathVariable String deviceId,
                                              @RequestParam(defaultValue = "temperature") String type,
                                              @RequestParam(required = false) Instant from,
                                              @RequestParam(required = false) Instant to,
                                              @RequestParam(defaultValue = "500") int limit,
                                              Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        accessGuard.requireReadAccess(me, deviceId);

        Instant effectiveFrom = from != null ? from : Instant.EPOCH;
        Instant effectiveTo = to != null ? to : Instant.now();
        int effectiveLimit = Math.min(limit, 5000);

        return jdbcTemplate.query("""
                        SELECT ts, device_id, type, value_num, payload::text AS payload, collector_id
                        FROM measurements
                        WHERE device_id = ? AND type = ? AND ts BETWEEN ? AND ?
                        ORDER BY ts DESC
                        LIMIT ?
                        """,
                (rs, rowNum) -> new MeasurementResponse(
                        rs.getTimestamp("ts").toInstant(),
                        rs.getString("device_id"),
                        rs.getString("type"),
                        (Double) rs.getObject("value_num"),
                        rs.getString("payload"),
                        rs.getString("collector_id")),
                deviceId, type, java.sql.Timestamp.from(effectiveFrom), java.sql.Timestamp.from(effectiveTo), effectiveLimit);
    }
}
