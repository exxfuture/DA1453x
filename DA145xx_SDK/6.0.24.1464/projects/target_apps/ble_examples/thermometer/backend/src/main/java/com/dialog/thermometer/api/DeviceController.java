package com.dialog.thermometer.api;

import com.dialog.thermometer.api.dto.ClaimDeviceRequest;
import com.dialog.thermometer.api.dto.DeviceResponse;
import com.dialog.thermometer.api.dto.RenameDeviceRequest;
import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.ConsentLink;
import com.dialog.thermometer.domain.ConsentLinkRepository;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import com.dialog.thermometer.domain.User;
import com.dialog.thermometer.domain.UserRepository;
import com.dialog.thermometer.security.AuditDetailWriter;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import jakarta.validation.Valid;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Device claiming (FR-3), the customer-facing fleet browser, and the
 * role-branched device listing that also backs the doctor and admin views
 * (see ConsentController for the doctor-patient relationship API and
 * AdminController for the admin-only force-release/edit actions).
 *
 * <p>Claiming is customer-only. A device can only ever have one owner at a
 * time — claiming an already-claimed device (by someone else) is a 409 — but
 * a customer may claim as many devices as they like (V3 dropped the earlier
 * one-device-per-customer cap; see V1__init.sql).
 */
@RestController
@RequestMapping("/api/devices")
public class DeviceController {

    /**
     * Ceiling on the admin branch of {@link #list}. That branch answers "every
     * device in the fleet", which is unbounded by construction, and this
     * endpoint returns a plain list with no page envelope. The paged admin
     * surfaces ({@code GET /api/admin/users} carries each user's devices, and
     * the device inventory panel under {@code /api/admin/analytics}) are the
     * ones meant for browsing a large fleet; this cap keeps a single response
     * from growing with the install base.
     */
    private static final int ADMIN_LIST_LIMIT = 500;

    private final DeviceRepository devices;
    private final UserRepository users;
    private final ConsentLinkRepository consentLinks;
    private final AuditLogRepository auditLogs;
    private final CurrentUserService currentUserService;
    private final AuditDetailWriter auditDetail;

    public DeviceController(DeviceRepository devices, UserRepository users, ConsentLinkRepository consentLinks,
                             AuditLogRepository auditLogs, CurrentUserService currentUserService,
                             AuditDetailWriter auditDetail) {
        this.devices = devices;
        this.users = users;
        this.consentLinks = consentLinks;
        this.auditLogs = auditLogs;
        this.currentUserService = currentUserService;
        this.auditDetail = auditDetail;
    }

    @PostMapping("/{bdAddr}/claim")
    public ResponseEntity<DeviceResponse> claim(@PathVariable String bdAddr,
                                                 @Valid @RequestBody(required = false) ClaimDeviceRequest request,
                                                 Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication, "only customers can claim a device",
                Role.CUSTOMER);

        ClaimDeviceRequest body = request != null ? request : new ClaimDeviceRequest(null, null);
        Device device = devices.findByBdAddr(bdAddr)
                .orElseGet(() -> new Device(bdAddr, body.model() != null ? body.model() : "unknown", body.fwVersion()));

        // Idempotent for the same owner; a device already owned by someone
        // else is a 409 — a device can only ever have one owner at a time,
        // but that's the only exclusivity rule (a customer may own several).
        if (device.getOwnerUserId() != null && !device.getOwnerUserId().equals(me.id())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }

        if (body.model() != null) {
            device.setModel(body.model());
        }
        if (body.fwVersion() != null) {
            device.setFwVersion(body.fwVersion());
        }
        device.claim(me.id());

        try {
            devices.save(device);
        } catch (DataIntegrityViolationException raceLostToConcurrentFirstClaim) {
            // Two concurrent first-time claims of the same brand-new bdAddr
            // can both pass the findByBdAddr()-empty check above and then
            // race to insert — the bd_addr UNIQUE constraint (V1) catches it.
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
        auditLogs.save(new AuditLog(me.id(), "device.claim", device.getBdAddr(), null));

        return ResponseEntity.ok(DeviceResponse.from(device, me.username()));
    }

    @PostMapping("/{bdAddr}/release")
    public ResponseEntity<Void> release(@PathVariable String bdAddr, Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication, "only customers can release a device",
                Role.CUSTOMER);

        Device device = devices.findByBdAddr(bdAddr)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!me.id().equals(device.getOwnerUserId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "you do not own this device");
        }
        device.release();
        devices.save(device);
        auditLogs.save(new AuditLog(me.id(), "device.release", bdAddr, null));

        return ResponseEntity.noContent().build();
    }

    /**
     * Owner-scoped rename: sets the friendly label shown in place of the BD
     * address across pickers and lists. Blank/null clears it (the UI falls
     * back to the model string). Scoped in the query rather than by a
     * post-hoc role check, so anyone who isn't the owning customer — another
     * customer, the consenting doctor, an admin — gets an indistinguishable
     * 404, same enumeration-safety rule as {@code ConsentController#revoke}
     * (proposals §5.9). Admin corrections go through
     * {@code AdminController#editDevice}, which carries the label too.
     */
    @PatchMapping("/{bdAddr}/label")
    public DeviceResponse renameLabel(@PathVariable String bdAddr,
                                       @Valid @RequestBody RenameDeviceRequest request,
                                       Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);

        String label = request.label() != null ? request.label().trim() : null;
        Device device = devices.findByBdAddrAndOwnerUserId(bdAddr, me.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        device.setLabel(label == null || label.isEmpty() ? null : label);
        devices.save(device);
        // Serialised, never concatenated: audit_log.detail is JSONB, so a label
        // containing a quote or a backslash would otherwise produce invalid JSON
        // and fail the insert — turning an ordinary rename into a 500.
        auditLogs.save(new AuditLog(me.id(), "device.rename", bdAddr, auditDetail.of("label", device.getLabel())));

        return DeviceResponse.from(device, me.username());
    }

    @GetMapping("/available")
    public List<DeviceResponse> available(Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication,
                "only customers browse available devices", Role.CUSTOMER);
        return enrich(devices.findByOwnerUserIdIsNull());
    }

    /**
     * Role-branched device list: own devices (customer), consenting patients'
     * devices (doctor), or the whole fleet (admin).
     *
     * <p>The admin branch is capped at {@link #ADMIN_LIST_LIMIT} rows — it is
     * the only branch whose size is bounded by the install base rather than by
     * one person's belongings, and this endpoint's response is a plain list with
     * no page envelope. Browsing a large fleet belongs on the paged admin
     * surfaces under {@code /api/admin}.
     */
    @GetMapping
    public List<DeviceResponse> list(Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        return switch (me.role()) {
            case CUSTOMER -> enrich(devices.findByOwnerUserId(me.id()));
            case DOCTOR -> {
                List<String> patientIds = consentLinks.findByDoctorUserIdAndRevokedAtIsNull(me.id()).stream()
                        .map(ConsentLink::getPatientUserId)
                        .toList();
                yield enrich(devices.findByOwnerUserIdIn(patientIds));
            }
            case ADMIN -> enrich(devices
                    .findAll(PageRequest.of(0, ADMIN_LIST_LIMIT, Sort.by(Sort.Direction.ASC, "bdAddr")))
                    .getContent());
        };
    }

    private List<DeviceResponse> enrich(List<Device> deviceList) {
        List<String> ownerIds = deviceList.stream()
                .map(Device::getOwnerUserId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<String, String> usernamesById = users.findAllById(ownerIds).stream()
                .collect(Collectors.toMap(User::getId, User::getUsername));
        return deviceList.stream()
                .map(d -> DeviceResponse.from(d, usernamesById.get(d.getOwnerUserId())))
                .toList();
    }
}
