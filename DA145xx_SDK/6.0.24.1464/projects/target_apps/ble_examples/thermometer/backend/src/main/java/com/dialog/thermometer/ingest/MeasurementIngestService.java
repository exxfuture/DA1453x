package com.dialog.thermometer.ingest;

import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import com.dialog.thermometer.security.AuditDetailWriter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.util.Optional;

/**
 * Idempotent write path shared by the MQTT subscriber and the REST fallback
 * upload endpoint (architecture v3 §8 / v2 §6). Dedup key is
 * (device_id, type, ts); redelivery of the same reading — from MQTT QoS 1 or
 * a retried HTTP POST — is a no-op, never a duplicate row.
 *
 * <p>Authorization differs by entry point and each has its own doorway:
 * {@link #ingestFromTopic} applies the broker path's ownership rule (derived
 * from the topic, which the broker's ACLs make trustworthy), while the REST path
 * is authorized by identity in {@code DeviceAccessGuard.requireIngestAccess}
 * before it ever calls {@link #ingest}. Calling {@link #ingest} directly means
 * "already authorized".
 */
@Service
public class MeasurementIngestService {

    private static final Logger log = LoggerFactory.getLogger(MeasurementIngestService.class);

    /**
     * The topic's user segment when the publisher is a trusted collector (the
     * one identity every gateway shares — see
     * {@code live/BrokerCredentialService}). Anything else in that position is a
     * browser user's own local id, because that is all the broker's per-user
     * ACLs let a browser publish under.
     */
    public static final String COLLECTOR_SEGMENT = "collector";

    /** Segment index of the user/collector part of {@code v1/{tenant}/{user}/{device}/measurement/{type}}. */
    private static final int USER_SEGMENT_INDEX = 2;

    /** audit_log.actor_id is VARCHAR(64); a topic segment is not trusted to be shorter. */
    private static final int MAX_ACTOR_LENGTH = 64;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final DeviceRepository deviceRepository;
    private final MqttGateway mqttGateway;
    private final AuditLogRepository auditLogs;
    private final AuditDetailWriter auditDetail;

    public MeasurementIngestService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper,
                                     DeviceRepository deviceRepository, MqttGateway mqttGateway,
                                     AuditLogRepository auditLogs, AuditDetailWriter auditDetail) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.deviceRepository = deviceRepository;
        this.mqttGateway = mqttGateway;
        this.auditLogs = auditLogs;
        this.auditDetail = auditDetail;
    }

    /**
     * Broker ingest path: applies the ownership rule the <i>topic</i> implies
     * before storing anything.
     *
     * <p>The broker's ACLs (dynamic-security, see
     * {@code live/BrokerCredentialService}) make the topic's user segment
     * trustworthy rather than a claim: a gateway may only publish under
     * {@code .../collector/...} and a browser user only under their own local
     * id. This method turns that into the same authorization decision the REST
     * upload path makes in {@code DeviceAccessGuard.requireIngestAccess}:
     *
     * <ul>
     *   <li>segment {@code collector} → trusted collector, stored as before
     *   (including self-registering an unknown device);</li>
     *   <li>any other segment → a browser user, accepted only for a device that
     *   is <b>unclaimed</b> (which is how a device becomes claimable at all) or
     *   <b>owned by that same user</b>.</li>
     * </ul>
     *
     * <p>Anything else is dropped with a WARN and an {@code ingest.rejected}
     * audit row, and never stored. Deliberately not thrown: an exception would
     * leave the QoS 1 message unacknowledged and redelivered forever, so a
     * rejected reading returns normally — it is refused, not retried.
     *
     * @return true if a new row was inserted; false for a duplicate <i>or</i> a refusal
     */
    public boolean ingestFromTopic(String topic, MeasurementEnvelope envelope) {
        String userSegment = userSegmentOf(topic);
        if (!COLLECTOR_SEGMENT.equals(userSegment)) {
            String ownerUserId = deviceRepository.findByBdAddr(envelope.deviceId())
                    .map(Device::getOwnerUserId)
                    .orElse(null);
            if (ownerUserId != null && !ownerUserId.equals(userSegment)) {
                recordRejection(topic, envelope, userSegment);
                return false;
            }
        }
        return ingest(envelope);
    }

    private static String userSegmentOf(String topic) {
        String[] segments = topic != null ? topic.split("/") : new String[0];
        return segments.length > USER_SEGMENT_INDEX ? segments[USER_SEGMENT_INDEX] : "";
    }

    private void recordRejection(String topic, MeasurementEnvelope envelope, String userSegment) {
        log.warn("Rejected reading for device {} published on {}: the device belongs to another user",
                envelope.deviceId(), topic);
        try {
            auditLogs.save(new AuditLog(truncate(userSegment), "ingest.rejected", envelope.deviceId(),
                    auditDetail.of("topic", topic, "reason", "device is owned by another user")));
        } catch (RuntimeException auditFailure) {
            // Same rule as AccessDeniedAuditor: a failed audit write must not
            // turn a refusal into an unacknowledged, endlessly redelivered message.
            log.warn("failed to record ingest.rejected audit entry for {}", topic, auditFailure);
        }
    }

    private static String truncate(String actorId) {
        return actorId.length() <= MAX_ACTOR_LENGTH ? actorId : actorId.substring(0, MAX_ACTOR_LENGTH);
    }

    /** @return true if a new row was inserted, false if this was a duplicate. */
    public boolean ingest(MeasurementEnvelope envelope) {
        Device device = ensureDeviceRegistered(envelope.deviceId());

        Double valueNum = extractPrimaryValue(envelope);
        String payloadJson;
        try {
            payloadJson = objectMapper.writeValueAsString(envelope.payload());
        } catch (Exception e) {
            throw new EnvelopeValidationException("payload is not serializable: " + e.getMessage());
        }

        int rows = jdbcTemplate.update("""
                INSERT INTO measurements (ts, device_id, type, value_num, payload, collector_id)
                VALUES (?, ?, ?, ?, ?::jsonb, ?)
                ON CONFLICT (device_id, type, ts) DO NOTHING
                """,
                Timestamp.from(envelope.ts()),
                envelope.deviceId(),
                envelope.type(),
                valueNum,
                payloadJson,
                envelope.collectorId());

        if (rows == 0) {
            log.debug("Duplicate measurement ignored: device={} type={} ts={}",
                    envelope.deviceId(), envelope.type(), envelope.ts());
        } else {
            recordLastSeen(envelope);
            publishLiveEvent(envelope, device != null ? device.getOwnerUserId() : null);
        }
        return rows > 0;
    }

    /**
     * Keeps devices.last_seen_at/type current (V1__init.sql) so
     * staleness views read one denormalised column instead of running an
     * ORDER BY ts DESC LIMIT 1 against the hypertable per device.
     *
     * <p>A targeted UPDATE rather than {@code Device.recordSeen} + a JPA
     * save: merging the whole detached entity back would write every column,
     * so a claim landing between this method's read and its write would be
     * silently rolled back. The WHERE clause also makes "only ever move
     * forward" atomic — a collector flushing a backlog of older readings
     * can't make a live device look stale.
     */
    private void recordLastSeen(MeasurementEnvelope envelope) {
        jdbcTemplate.update("""
                UPDATE devices
                SET last_seen_at = ?, last_seen_type = ?
                WHERE bd_addr = ? AND (last_seen_at IS NULL OR last_seen_at < ?)
                """,
                Timestamp.from(envelope.ts()), envelope.type(), envelope.deviceId(), Timestamp.from(envelope.ts()));
    }

    /**
     * First reading from a bdAddr the backend hasn't seen registers it as an
     * unclaimed device — this is what makes the simulated gateway fleet (and
     * any real device) show up in GET /api/devices/available a few seconds
     * after it starts publishing, with no manual seeding. Racing concurrent
     * first-readings for the same new device are resolved by the devices
     * table's existing bd_addr UNIQUE constraint; the loser here just means
     * another thread already registered it.
     */
    private Device ensureDeviceRegistered(String bdAddr) {
        Optional<Device> existing = deviceRepository.findByBdAddr(bdAddr);
        if (existing.isPresent()) {
            return existing.get();
        }
        try {
            return deviceRepository.save(new Device(bdAddr, "unknown", null));
        } catch (DataIntegrityViolationException alreadyRegisteredConcurrently) {
            log.debug("Device {} was registered concurrently by another ingest call", bdAddr);
            return deviceRepository.findByBdAddr(bdAddr).orElse(null);
        }
    }

    /**
     * Fans the reading out to the owning customer's live topic (architecture
     * v3 §7: browsers/mobile subscribe to {@code live/{user_id}/...} directly
     * on the broker, no relay through this service). Runs for both the MQTT
     * and REST ingest paths since both call {@link #ingest}. Devices that
     * haven't been claimed yet (no owner) simply have nothing to fan out to.
     * The owner comes from the row {@link #ensureDeviceRegistered} already
     * loaded, so this costs no extra query.
     */
    private void publishLiveEvent(MeasurementEnvelope envelope, String ownerUserId) {
        if (ownerUserId == null) {
            return;
        }
        String topic = "live/" + ownerUserId + "/" + envelope.deviceId() + "/" + envelope.type();
        try {
            mqttGateway.publish(topic, objectMapper.writeValueAsBytes(envelope));
        } catch (Exception e) {
            log.warn("Failed to serialize live event for device={}: {}", envelope.deviceId(), e.getMessage());
        }
    }

    /**
     * Pulls out the one scalar that backs continuous aggregates and fast
     * charts; the full typed document always lives in {@code payload}
     * regardless. New measurement types register their scalar field name
     * here — the one place FR-9 extensibility touches ingest code.
     */
    private Double extractPrimaryValue(MeasurementEnvelope envelope) {
        Object raw = switch (envelope.type()) {
            case "temperature" -> envelope.payload().get("celsius");
            case "humidity" -> envelope.payload().get("relative_humidity_pct");
            case "battery" -> envelope.payload().get("percent");
            default -> null;
        };
        return raw instanceof Number number ? number.doubleValue() : null;
    }
}
