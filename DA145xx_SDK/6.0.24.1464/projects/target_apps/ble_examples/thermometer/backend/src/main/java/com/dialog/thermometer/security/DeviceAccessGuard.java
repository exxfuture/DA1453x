package com.dialog.thermometer.security;

import com.dialog.thermometer.domain.ConsentLinkRepository;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * The single place "may this caller read — or write — this device's data?" is
 * decided. Extracted from MeasurementController so every reader of
 * device-scoped data (measurements, events, annotations) enforces the same
 * rule instead of re-deriving it — a re-implementation is how these checks
 * drift apart.
 */
@Component
public class DeviceAccessGuard {

    private final DeviceRepository devices;
    private final ConsentLinkRepository consentLinks;

    public DeviceAccessGuard(DeviceRepository devices, ConsentLinkRepository consentLinks) {
        this.devices = devices;
        this.consentLinks = consentLinks;
    }

    /**
     * Customer: must own the device. Doctor: the device's current owner must
     * have an active consent link to this doctor. Admin: unrestricted. A
     * device with no owner (unclaimed, or no devices row at all yet) is only
     * readable by an admin — nobody can "own" history for a device nobody
     * has claimed.
     *
     * @throws ResponseStatusException 403 if the caller has no read access
     */
    public void requireReadAccess(CurrentUser me, String bdAddr) {
        if (me.role() == Role.ADMIN) {
            return;
        }

        String ownerUserId = devices.findByBdAddr(bdAddr).map(Device::getOwnerUserId).orElse(null);
        boolean allowed = switch (me.role()) {
            case CUSTOMER -> me.id().equals(ownerUserId);
            case DOCTOR -> ownerUserId != null
                    && consentLinks.existsByPatientUserIdAndDoctorUserIdAndRevokedAtIsNull(ownerUserId, me.id());
            case ADMIN -> true;
        };
        if (!allowed) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "no access to this device's measurements");
        }
    }

    /**
     * Write rule for the REST ingest path — deliberately both stricter and
     * narrower than {@link #requireReadAccess}: only a <b>customer</b> may
     * submit readings, and only for a device they own.
     *
     * <p>Doctor and admin are rejected outright rather than granted the
     * superset they get for reads. Nobody submits readings on a patient's
     * behalf — a reading is something a device produced — and an injected one
     * is not merely a wrong point on a chart: it feeds {@code
     * TemperatureEventService} episode detection and the doctor dashboard's
     * {@code riskScore}/{@code riskTier} triage, i.e. it can misdirect
     * clinical attention.
     *
     * <p>A device with <b>no owner</b> (unclaimed, or with no {@code devices}
     * row at all yet) is accepted from any customer, because that is the only
     * way this system ever learns a device exists: {@code
     * MeasurementIngestService.ensureDeviceRegistered} registers an unknown
     * {@code bd_addr} on its first reading, which is what makes it appear in
     * {@code GET /api/devices/available} to be claimed — and the browser
     * collector (fe {@code ConnectPage}) starts uploading as soon as it
     * connects, before the user has clicked "claim". Requiring ownership here
     * would deadlock that: nothing could be claimed until it had been seen,
     * and nothing could be seen until it had been claimed.
     *
     * <p><b>Residual risk, accepted:</b> a customer can therefore still seed
     * readings for a {@code bd_addr} nobody has claimed. Such data is
     * unreadable by anyone but an admin while it stays unclaimed (see
     * {@link #requireReadAccess}) and reaches no doctor's dashboard, so it is
     * a pre-poisoning nuisance against whoever later claims that exact
     * address — not the cross-patient injection this method closes. Removing
     * it needs collectors to authenticate as the device rather than as a
     * person, i.e. the per-device credentials tracked as {@code
     * ../proposals.md} 10.1.
     *
     * @throws ResponseStatusException 403 if the caller may not write this device's readings
     */
    public void requireIngestAccess(CurrentUser me, String bdAddr) {
        if (me.role() != Role.CUSTOMER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "only a customer can upload readings, and only for their own device");
        }
        String ownerUserId = devices.findByBdAddr(bdAddr).map(Device::getOwnerUserId).orElse(null);
        if (ownerUserId != null && !ownerUserId.equals(me.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "you do not own this device");
        }
    }
}
