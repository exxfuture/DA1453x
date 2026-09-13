package com.dialog.thermometer.event;

import com.dialog.thermometer.api.dto.PatientEventsResponse;
import com.dialog.thermometer.domain.ConsentLink;
import com.dialog.thermometer.domain.ConsentLinkRepository;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import com.dialog.thermometer.domain.User;
import com.dialog.thermometer.domain.UserRepository;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.DeviceAccessGuard;
import com.dialog.thermometer.security.Role;
import com.dialog.thermometer.threshold.AlertThresholdService;
import com.dialog.thermometer.threshold.AlertThresholdService.ResolvedThresholds;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Fever-episode history, derived on read from the measurements hypertable —
 * see {@link TemperatureEventService} for why there is no events table.
 *
 * <p>Because episodes are derived, the thresholds used to derive them matter:
 * a doctor viewing a patient sees the episodes <i>their own</i> override
 * implies, while the patient sees the ones their own scale implies. Both are
 * correct; the scale is part of the question, not a global constant.
 */
@RestController
@RequestMapping("/api/events")
public class EventController {

    /** Window used when the caller gives no {@code from} — matches what the history views ask for by default. */
    private static final Duration DEFAULT_WINDOW = Duration.ofDays(7);

    /**
     * Widest window a single request may ask for. Episode detection pulls raw
     * readings into memory (bounded again inside TemperatureEventService), so
     * an open-ended range across a whole fleet is refused rather than served
     * slowly.
     */
    private static final Duration MAX_WINDOW = Duration.ofDays(90);

    private final TemperatureEventService events;
    private final AlertThresholdService thresholds;
    private final DeviceAccessGuard accessGuard;
    private final DeviceRepository devices;
    private final ConsentLinkRepository consentLinks;
    private final UserRepository users;
    private final CurrentUserService currentUserService;

    public EventController(TemperatureEventService events, AlertThresholdService thresholds,
                            DeviceAccessGuard accessGuard, DeviceRepository devices,
                            ConsentLinkRepository consentLinks, UserRepository users,
                            CurrentUserService currentUserService) {
        this.events = events;
        this.thresholds = thresholds;
        this.accessGuard = accessGuard;
        this.devices = devices;
        this.consentLinks = consentLinks;
        this.users = users;
        this.currentUserService = currentUserService;
    }

    /** Episodes for one device. Access rules are exactly the measurement-history ones. */
    @GetMapping("/device/{bdAddr}")
    public List<TemperatureEvent> deviceEvents(@PathVariable String bdAddr,
                                                @RequestParam(required = false) Instant from,
                                                @RequestParam(required = false) Instant to,
                                                Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        accessGuard.requireReadAccess(me, bdAddr);
        Window window = Window.of(from, to);

        String ownerUserId = devices.findByBdAddr(bdAddr).map(Device::getOwnerUserId).orElse(null);
        ResolvedThresholds scale = ownerUserId == null
                // An unclaimed device (admin-only, per DeviceAccessGuard) has
                // no subject to resolve a personal scale for.
                ? AlertThresholdService.FALLBACK
                : thresholds.resolve(ownerUserId, viewingDoctorId(me));

        return events.detect(bdAddr, window.from(), window.to(), scale);
    }

    /**
     * Fleet-wide feed for a doctor: every consenting patient's episodes in one
     * window. Fixed query count regardless of patient count — consents,
     * devices and usernames are one query each, thresholds are three
     * (resolveBatch), and every device's readings come back in a single
     * detectBatch query.
     */
    @GetMapping("/patients")
    public List<PatientEventsResponse> patientEvents(@RequestParam(required = false) Instant from,
                                                      @RequestParam(required = false) Instant to,
                                                      Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        if (me.role() != Role.DOCTOR) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only doctors have patients");
        }
        Window window = Window.of(from, to);

        List<String> patientIds = consentLinks.findByDoctorUserIdAndRevokedAtIsNull(me.id()).stream()
                .map(ConsentLink::getPatientUserId)
                .distinct()
                .toList();
        if (patientIds.isEmpty()) {
            return List.of();
        }

        List<Device> patientDevices = devices.findByOwnerUserIdIn(patientIds);
        Map<String, String> usernamesById = users.findAllById(patientIds).stream()
                .collect(Collectors.toMap(User::getId, User::getUsername));
        Map<String, ResolvedThresholds> scaleByPatient = thresholds.resolveBatch(patientIds, me.id());

        Map<String, ResolvedThresholds> scaleByDevice = new HashMap<>(patientDevices.size());
        for (Device device : patientDevices) {
            ResolvedThresholds scale = scaleByPatient.get(device.getOwnerUserId());
            scaleByDevice.put(device.getBdAddr(), scale != null ? scale : AlertThresholdService.FALLBACK);
        }

        Map<String, List<TemperatureEvent>> eventsByDevice = events.detectBatch(
                patientDevices.stream().map(Device::getBdAddr).toList(), window.from(), window.to(), scaleByDevice);

        // Grouped by patient rather than by device: a patient with two
        // thermometers is still one row in the doctor's feed.
        Map<String, List<Device>> devicesByOwner = patientDevices.stream()
                .filter(d -> d.getOwnerUserId() != null)
                .collect(Collectors.groupingBy(Device::getOwnerUserId));

        return patientIds.stream().flatMap(patientId -> {
            List<Device> owned = devicesByOwner.getOrDefault(patientId, List.of());
            if (owned.isEmpty()) {
                return java.util.stream.Stream.of(
                        new PatientEventsResponse(patientId, usernamesById.get(patientId), null, List.of()));
            }
            return owned.stream().map(device -> new PatientEventsResponse(
                    patientId,
                    usernamesById.get(patientId),
                    device.getBdAddr(),
                    eventsByDevice.getOrDefault(device.getBdAddr(), List.of())));
        }).toList();
    }

    private static String viewingDoctorId(CurrentUser me) {
        return me.role() == Role.DOCTOR ? me.id() : null;
    }

    /** Normalised, bounded time window shared by both endpoints. */
    private record Window(Instant from, Instant to) {

        static Window of(Instant from, Instant to) {
            Instant effectiveTo = to != null ? to : Instant.now();
            Instant effectiveFrom = from != null ? from : effectiveTo.minus(DEFAULT_WINDOW);
            if (!effectiveFrom.isBefore(effectiveTo)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from must be before to");
            }
            if (Duration.between(effectiveFrom, effectiveTo).compareTo(MAX_WINDOW) > 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "window may not exceed " + MAX_WINDOW.toDays() + " days");
            }
            return new Window(effectiveFrom, effectiveTo);
        }
    }
}
