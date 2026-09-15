package com.dialog.thermometer.admin;

import com.dialog.thermometer.api.dto.AdminUserResponse;
import com.dialog.thermometer.api.dto.AuditLogResponse;
import com.dialog.thermometer.api.dto.CareNoteResponse;
import com.dialog.thermometer.api.dto.ConsentResponse;
import com.dialog.thermometer.api.dto.DeviceResponse;
import com.dialog.thermometer.api.dto.EditDeviceRequest;
import com.dialog.thermometer.api.dto.PageResponse;
import com.dialog.thermometer.api.dto.UpdateUserRoleRequest;
import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.CareNote;
import com.dialog.thermometer.domain.CareNoteRepository;
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
import jakarta.persistence.criteria.Predicate;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Full-visibility, full-edit-rights views for admin: every user, every
 * device (claimed or not), every doctor-patient relationship, plus the
 * force-release/edit actions on any device. Admin never claims a device for
 * itself (that stays customer-only in DeviceController) — this is the
 * dedicated "fix it for someone else" surface instead.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final UserRepository users;
    private final DeviceRepository devices;
    private final ConsentLinkRepository consentLinks;
    private final AuditLogRepository auditLogs;
    private final CareNoteRepository careNotes;
    private final CurrentUserService currentUserService;
    private final AuditDetailWriter auditDetail;

    public AdminController(UserRepository users, DeviceRepository devices, ConsentLinkRepository consentLinks,
                            AuditLogRepository auditLogs, CareNoteRepository careNotes,
                            CurrentUserService currentUserService, AuditDetailWriter auditDetail) {
        this.users = users;
        this.devices = devices;
        this.consentLinks = consentLinks;
        this.auditLogs = auditLogs;
        this.careNotes = careNotes;
        this.currentUserService = currentUserService;
        this.auditDetail = auditDetail;
    }

    /**
     * Paged, searchable user browser. {@code q} matches username or email
     * case-insensitively, {@code role} filters exactly; both are optional and
     * independent (UserRepository.search).
     *
     * <p>The device and consent enrichment is scoped to the users on the
     * current page — it used to read the whole devices and consent_links
     * tables on every request, which is a table scan that grows with the
     * install base to render twenty rows.
     */
    @GetMapping("/users")
    public PageResponse<AdminUserResponse> users(@RequestParam(required = false) String q,
                                                  @RequestParam(required = false) String role,
                                                  Pageable pageable,
                                                  Authentication authentication) {
        requireAdmin(authentication);

        Page<User> page = users.search(blankToNull(q), blankToNull(role), sortedByDefault(pageable, "username"));
        List<String> pageUserIds = page.getContent().stream().map(User::getId).toList();
        if (pageUserIds.isEmpty()) {
            return PageResponse.of(page, List.of());
        }

        // A customer may own several devices (V3 dropped the earlier one-per-
        // customer cap), so this is a one-to-many grouping, not a toMap().
        Map<String, List<Device>> devicesByOwner = devices.findByOwnerUserIdIn(pageUserIds).stream()
                .filter(d -> d.getOwnerUserId() != null)
                .collect(Collectors.groupingBy(Device::getOwnerUserId));

        List<ConsentLink> pageLinks = consentLinks.findActiveInvolving(pageUserIds);
        Map<String, Long> patientCounts = pageLinks.stream()
                .collect(Collectors.groupingBy(ConsentLink::getDoctorUserId, Collectors.counting()));
        Map<String, Long> doctorCounts = pageLinks.stream()
                .collect(Collectors.groupingBy(ConsentLink::getPatientUserId, Collectors.counting()));

        return PageResponse.of(page, page.getContent().stream().map(user -> {
            List<AdminUserResponse.DeviceSummary> deviceSummaries = devicesByOwner
                    .getOrDefault(user.getId(), List.of()).stream()
                    .map(d -> new AdminUserResponse.DeviceSummary(d.getBdAddr(), d.getModel()))
                    .toList();
            long activeConsentCount = switch (Role.fromDbValue(user.getRole())) {
                case DOCTOR -> patientCounts.getOrDefault(user.getId(), 0L);
                case CUSTOMER -> doctorCounts.getOrDefault(user.getId(), 0L);
                case ADMIN -> 0L;
            };
            return new AdminUserResponse(
                    user.getId(), user.getUsername(), user.getEmail(), user.getRole(), user.getDisplayName(),
                    deviceSummaries, activeConsentCount);
        }).toList());
    }

    /**
     * Changes a user's role in the local registry.
     *
     * <p><b>This does not change anything in Keycloak.</b> CurrentUserService
     * re-syncs {@code users.role} from the JWT's {@code realm_access.roles} on
     * every request, so a change made here is authoritative only until that
     * user's next call and is then overwritten by the identity provider. It is
     * a correction tool for the local mirror (and an audited record of the
     * attempt), not a substitute for editing the realm — see
     * backend/README.md "Roles &amp; identity".
     */
    @PatchMapping("/users/{id}")
    public AdminUserResponse updateUserRole(@PathVariable String id,
                                             @Valid @RequestBody UpdateUserRoleRequest request,
                                             Authentication authentication) {
        CurrentUser me = requireAdmin(authentication);
        // Self-lockout guard: an admin demoting themselves would immediately
        // lose the only role that can undo it.
        if (me.id().equals(id)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "an admin cannot change their own role");
        }
        Role newRole = request.parsedRole();
        if (newRole == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown role: " + request.role());
        }
        User user = users.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        String oldRole = user.getRole();
        user.setRole(newRole.dbValue());
        user.touch();
        users.save(user);
        // audit_log.detail is JSONB, so the value has to be valid JSON — built
        // through AuditDetailWriter rather than string-formatted, which is the
        // one habit that keeps a future non-enum value from breaking the insert.
        auditLogs.save(new AuditLog(me.id(), "admin.user.role_change", id,
                auditDetail.of("from", oldRole, "to", newRole.dbValue())));

        return new AdminUserResponse(user.getId(), user.getUsername(), user.getEmail(), user.getRole(),
                user.getDisplayName(), List.of(), 0);
    }

    @GetMapping("/consents")
    public PageResponse<ConsentResponse> consents(Pageable pageable, Authentication authentication) {
        requireAdmin(authentication);
        Page<ConsentLink> page = consentLinks.findAll(sortedByDefault(pageable, "grantedAt", Sort.Direction.DESC));
        List<String> userIds = page.getContent().stream()
                .flatMap(l -> java.util.stream.Stream.of(l.getPatientUserId(), l.getDoctorUserId()))
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<String, String> usernamesById = userIds.isEmpty() ? Map.of()
                : users.findAllById(userIds).stream().collect(Collectors.toMap(User::getId, User::getUsername));
        return PageResponse.of(page, page.getContent().stream()
                .map(l -> ConsentResponse.from(l, usernamesById.get(l.getPatientUserId()), usernamesById.get(l.getDoctorUserId())))
                .toList());
    }

    /**
     * Filterable audit-log viewer. Every filter is optional and they combine
     * with AND; built as a {@link Specification} rather than a derived-query
     * per combination, which is what {@link AuditLogRepository}'s
     * {@code JpaSpecificationExecutor} is there for.
     */
    @GetMapping("/audit-log")
    public PageResponse<AuditLogResponse> auditLog(@RequestParam(required = false) String actorId,
                                                    @RequestParam(required = false) String action,
                                                    @RequestParam(required = false) String subject,
                                                    @RequestParam(required = false) Instant from,
                                                    @RequestParam(required = false) Instant to,
                                                    Pageable pageable,
                                                    Authentication authentication) {
        requireAdmin(authentication);
        Page<AuditLog> page = auditLogs.findAll(auditLogFilter(actorId, action, subject, from, to),
                sortedByDefault(pageable, "at", Sort.Direction.DESC));

        List<String> actorIds = page.getContent().stream().map(AuditLog::getActorId).filter(Objects::nonNull)
                .distinct().toList();
        Map<String, String> usernamesById = actorIds.isEmpty() ? Map.of()
                : users.findAllById(actorIds).stream().collect(Collectors.toMap(User::getId, User::getUsername));

        return PageResponse.of(page, page.getContent().stream()
                .map(entry -> AuditLogResponse.from(entry, usernamesById.get(entry.getActorId())))
                .toList());
    }

    /**
     * Read-only compliance view of care notes for one patient — the only path
     * by which anyone other than the authoring doctor can see them (see
     * CareNoteController for why they are otherwise doctor-private). Admins
     * cannot write or edit them: a clinical note must stay attributable to
     * the clinician who wrote it.
     *
     * <p>{@code patientUserId} is required on purpose. Without it this would
     * be "dump every clinical note in the system", which is not a compliance
     * lookup — it's a breach with an audit trail.
     */
    @GetMapping("/care-notes")
    public List<CareNoteResponse> careNotes(@RequestParam String patientUserId,
                                             @RequestParam(required = false) String doctorUserId,
                                             Authentication authentication) {
        requireAdmin(authentication);
        List<CareNote> notes = careNotes.findByPatientUserIdOrderByCreatedAtDesc(patientUserId).stream()
                .filter(note -> doctorUserId == null || doctorUserId.isBlank()
                        || doctorUserId.equals(note.getDoctorUserId()))
                .toList();

        List<String> ids = java.util.stream.Stream.concat(java.util.stream.Stream.of(patientUserId),
                notes.stream().map(CareNote::getDoctorUserId)).filter(Objects::nonNull).distinct().toList();
        Map<String, String> usernamesById = users.findAllById(ids).stream()
                .collect(Collectors.toMap(User::getId, User::getUsername));

        return notes.stream()
                .map(note -> CareNoteResponse.from(note, usernamesById.get(note.getDoctorUserId()),
                        usernamesById.get(patientUserId)))
                .toList();
    }

    @PostMapping("/devices/{bdAddr}/release")
    public ResponseEntity<Void> releaseDevice(@PathVariable String bdAddr, Authentication authentication) {
        CurrentUser me = requireAdmin(authentication);
        Device device = devices.findByBdAddr(bdAddr).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        device.release();
        devices.save(device);
        auditLogs.save(new AuditLog(me.id(), "admin.device.release", bdAddr, null));
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/devices/{bdAddr}")
    public ResponseEntity<DeviceResponse> editDevice(@PathVariable String bdAddr,
                                                      @Valid @RequestBody EditDeviceRequest request,
                                                      Authentication authentication) {
        CurrentUser me = requireAdmin(authentication);
        Device device = devices.findByBdAddr(bdAddr).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (request.model() != null) {
            device.setModel(request.model());
        }
        if (request.fwVersion() != null) {
            device.setFwVersion(request.fwVersion());
        }
        if (request.label() != null) {
            String label = request.label().trim();
            device.setLabel(label.isEmpty() ? null : label);
        }
        devices.save(device);
        auditLogs.save(new AuditLog(me.id(), "admin.device.edit", bdAddr, null));

        String ownerUsername = device.getOwnerUserId() != null
                ? users.findById(device.getOwnerUserId()).map(User::getUsername).orElse(null)
                : null;
        return ResponseEntity.ok(DeviceResponse.from(device, ownerUsername));
    }

    private CurrentUser requireAdmin(Authentication authentication) {
        return currentUserService.resolveWithRole(authentication, "admin role required", Role.ADMIN);
    }

    private static Specification<AuditLog> auditLogFilter(String actorId, String action, String subject,
                                                           Instant from, Instant to) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (blankToNull(actorId) != null) {
                predicates.add(cb.equal(root.get("actorId"), actorId));
            }
            if (blankToNull(action) != null) {
                predicates.add(cb.equal(root.get("action"), action));
            }
            if (blankToNull(subject) != null) {
                predicates.add(cb.equal(root.get("subject"), subject));
            }
            if (from != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("at"), from));
            }
            if (to != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("at"), to));
            }
            // conjunction() rather than null: an all-filters-absent request is
            // "everything", and returning null here would leave the caller to
            // guess whether that meant "no restriction" or "match nothing".
            return predicates.isEmpty() ? cb.conjunction() : cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    /** An empty query parameter means "not filtering", not "match the empty string". */
    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static Pageable sortedByDefault(Pageable pageable, String property) {
        return sortedByDefault(pageable, property, Sort.Direction.ASC);
    }

    /** Applies a stable default ordering when the client didn't ask for one — an unsorted page is a non-deterministic page. */
    private static Pageable sortedByDefault(Pageable pageable, String property, Sort.Direction direction) {
        return pageable.getSort().isSorted()
                ? pageable
                : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by(direction, property));
    }
}
