package com.dialog.thermometer.api;

import com.dialog.thermometer.api.dto.AuditLogResponse;
import com.dialog.thermometer.api.dto.ConsentHistoryResponse;
import com.dialog.thermometer.api.dto.ConsentResponse;
import com.dialog.thermometer.api.dto.DoctorResponse;
import com.dialog.thermometer.api.dto.GrantConsentRequest;
import com.dialog.thermometer.api.dto.PageResponse;
import com.dialog.thermometer.api.dto.PatientResponse;
import com.dialog.thermometer.api.dto.PatientSummaryResponse;
import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.ConsentLink;
import com.dialog.thermometer.domain.ConsentLinkRepository;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import com.dialog.thermometer.domain.User;
import com.dialog.thermometer.domain.UserRepository;
import com.dialog.thermometer.patient.PatientSummaryService;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import com.dialog.thermometer.threshold.AlertThresholdService;
import com.dialog.thermometer.threshold.AlertThresholdService.ResolvedThresholds;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * FR-4: patient-initiated consent linking a customer's data to a doctor.
 * Grant/revoke is always initiated by the patient (or, on their behalf, an
 * admin); a doctor can only read/list, never self-grant.
 */
@RestController
@RequestMapping("/api")
public class ConsentController {

    /**
     * The only actions the audit log records about consent. Both are written
     * by this controller; nothing else appends them.
     */
    private static final List<String> CONSENT_ACTIONS = List.of("consent.grant", "consent.revoke");

    /**
     * Ceiling on the admin branch of {@link #list}. That branch answers "every
     * consent link in the system", which grows with the install base, and this
     * endpoint returns a plain list with no page envelope — the paged equivalent
     * is {@code GET /api/admin/consents}.
     */
    private static final int ADMIN_LIST_LIMIT = 500;

    private final UserRepository users;
    private final DeviceRepository devices;
    private final ConsentLinkRepository consentLinks;
    private final AuditLogRepository auditLogs;
    private final CurrentUserService currentUserService;
    private final AlertThresholdService alertThresholds;
    private final PatientSummaryService patientSummaries;

    public ConsentController(UserRepository users, DeviceRepository devices, ConsentLinkRepository consentLinks,
                              AuditLogRepository auditLogs, CurrentUserService currentUserService,
                              AlertThresholdService alertThresholds, PatientSummaryService patientSummaries) {
        this.users = users;
        this.devices = devices;
        this.consentLinks = consentLinks;
        this.auditLogs = auditLogs;
        this.currentUserService = currentUserService;
        this.alertThresholds = alertThresholds;
        this.patientSummaries = patientSummaries;
    }

    @GetMapping("/doctors")
    public List<DoctorResponse> doctors(Authentication authentication) {
        currentUserService.resolveWithRole(authentication, "only a customer or an admin lists doctors",
                Role.CUSTOMER, Role.ADMIN);
        return users.findByRole(Role.DOCTOR.dbValue()).stream().map(DoctorResponse::from).toList();
    }

    @PostMapping("/consents")
    public ResponseEntity<ConsentResponse> grant(@Valid @RequestBody GrantConsentRequest request, Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication,
                "only a customer can grant consent to their own data", Role.CUSTOMER);
        User doctor = users.findById(request.doctorUserId())
                .filter(u -> Role.DOCTOR.dbValue().equals(u.getRole()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no such doctor"));

        ConsentLink link = consentLinks.findByPatientUserIdAndDoctorUserIdAndRevokedAtIsNull(me.id(), doctor.getId())
                .orElseGet(() -> consentLinks.save(new ConsentLink(me.id(), doctor.getId())));
        auditLogs.save(new AuditLog(me.id(), "consent.grant", doctor.getId(), null));

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ConsentResponse.from(link, me.username(), doctor.getUsername()));
    }

    /**
     * The patient who granted the link, or an admin on their behalf.
     *
     * <p>Scoped by owner in the query itself for everyone but the admin, so a
     * caller who may not revoke a link gets <b>404, not 403</b> — a 403 would
     * confirm that consent id exists. Same convention as {@code
     * AnnotationController} and {@code CareNoteController}'s edit/delete.
     */
    @DeleteMapping("/consents/{id}")
    public ResponseEntity<Void> revoke(@PathVariable UUID id, Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        ConsentLink link = (me.role() == Role.ADMIN
                ? consentLinks.findById(id)
                : consentLinks.findByIdAndPatientUserId(id, me.id()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        link.revoke();
        consentLinks.save(link);
        auditLogs.save(new AuditLog(me.id(), "consent.revoke", link.getDoctorUserId(), null));
        return ResponseEntity.noContent().build();
    }

    /**
     * Role-branched consent list: own links including revoked ones (customer),
     * active links pointing at the caller (doctor), or every link (admin).
     *
     * <p>The admin branch is capped at {@link #ADMIN_LIST_LIMIT} newest links —
     * see {@code GET /api/admin/consents} for the paged view meant for browsing.
     */
    @GetMapping("/consents")
    public List<ConsentResponse> list(Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        List<ConsentLink> links = switch (me.role()) {
            case CUSTOMER -> consentLinks.findByPatientUserId(me.id());
            case DOCTOR -> consentLinks.findByDoctorUserIdAndRevokedAtIsNull(me.id());
            case ADMIN -> consentLinks
                    .findAll(PageRequest.of(0, ADMIN_LIST_LIMIT, Sort.by(Sort.Direction.DESC, "grantedAt")))
                    .getContent();
        };
        return enrich(links);
    }

    @GetMapping("/doctor/patients")
    public List<PatientResponse> myPatients(Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication, "only doctors have patients", Role.DOCTOR);
        List<ConsentLink> active = consentLinks.findByDoctorUserIdAndRevokedAtIsNull(me.id());
        Map<String, String> usernamesById = users.findAllById(active.stream().map(ConsentLink::getPatientUserId).toList())
                .stream().collect(Collectors.toMap(User::getId, User::getUsername));

        return active.stream().map(link -> {
            String patientId = link.getPatientUserId();
            Optional<Device> device = devices.findByOwnerUserId(patientId).stream().findFirst();
            return new PatientResponse(
                    patientId,
                    usernamesById.get(patientId),
                    device.map(Device::getBdAddr).orElse(null),
                    device.map(Device::getModel).orElse(null));
        }).toList();
    }

    /**
     * Doctor dashboard "at a glance" data: one row per consenting patient
     * with the latest reading (unbounded — always the true last-known
     * value, so a stale patient still shows something) plus avg/min/max/
     * stddev/count/sparkline scoped to {@code rangeHours}, and a derived
     * staleness flag and risk ranking.
     *
     * <p>All of that is computed by {@code patient/PatientSummaryService}; this
     * method resolves the caller, enforces the doctor-only rule, batch-resolves
     * every patient's threshold scale in three queries (including this doctor's
     * own overrides, since the tiers the risk score is built from are the ones
     * this doctor set) and maps the result.
     */
    @GetMapping("/doctor/patients/summary")
    public List<PatientSummaryResponse> myPatientsSummary(
            @RequestParam(defaultValue = "24") int rangeHours, Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication, "only doctors have patients", Role.DOCTOR);
        List<ConsentLink> active = consentLinks.findByDoctorUserIdAndRevokedAtIsNull(me.id());
        List<String> patientIds = active.stream().map(ConsentLink::getPatientUserId).toList();
        Map<String, String> usernamesById = users.findAllById(patientIds).stream()
                .collect(Collectors.toMap(User::getId, User::getUsername));
        // Three queries for every patient's scale, not three per patient —
        // and it must include this doctor's own overrides, since the tiers
        // the risk score is built from are the ones this doctor set.
        Map<String, ResolvedThresholds> scaleByPatient = alertThresholds.resolveBatch(patientIds, me.id());

        Instant to = Instant.now();
        Instant from = to.minusSeconds(Math.max(1, rangeHours) * 3600L);

        return active.stream().map(link -> {
            String patientId = link.getPatientUserId();
            String username = usernamesById.get(patientId);
            ResolvedThresholds scale = scaleByPatient.getOrDefault(patientId, AlertThresholdService.FALLBACK);
            Optional<Device> device = devices.findByOwnerUserId(patientId).stream().findFirst();
            return device.map(d -> patientSummaries.summarize(patientId, username, d, from, to, scale))
                    .orElseGet(() -> patientSummaries.noDevice(patientId, username));
        }).toList();
    }

    /**
     * A customer's own consent history: shares they granted, shares they
     * revoked.
     *
     * <p>Named "consent history" and not "access history" on purpose — the
     * audit log records consent lifecycle events, never reads, so this cannot
     * and does not answer "who looked at my data". Wiring a UI that claims
     * otherwise would be a privacy lie; see ConsentHistoryResponse.
     */
    @GetMapping("/consents/access-history")
    public PageResponse<ConsentHistoryResponse> myConsentHistory(Pageable pageable, Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication,
                "only a customer has a consent history", Role.CUSTOMER);
        Page<AuditLog> page = auditLogs.findByActorIdAndActionInOrderByAtDesc(me.id(), CONSENT_ACTIONS,
                atDescByDefault(pageable));
        // subject holds the doctor's id for both consent actions.
        Map<String, String> usernamesById = usernamesOf(page.getContent().stream().map(AuditLog::getSubject).toList());
        return PageResponse.of(page,
                page.getContent().stream()
                        .map(entry -> ConsentHistoryResponse.from(entry, usernamesById.get(entry.getSubject())))
                        .toList());
    }

    /**
     * Consent actions this doctor performed themselves.
     *
     * <p>In normal operation this is empty: consent is patient-initiated
     * (see {@link #grant}), so a doctor is the <i>subject</i> of those
     * entries, not the actor. It is here as the doctor-side counterpart of
     * the customer feed and to surface anything a doctor account did action —
     * which, precisely because it should not happen, is worth being able to
     * see. The doctor's involvement as a subject is covered by
     * {@link #myAuditLog}.
     */
    @GetMapping("/doctor/consent-activity")
    public PageResponse<AuditLogResponse> doctorConsentActivity(Pageable pageable, Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication, "doctor role required", Role.DOCTOR);
        Page<AuditLog> page = auditLogs.findByActorIdAndActionInOrderByAtDesc(me.id(), CONSENT_ACTIONS,
                atDescByDefault(pageable));
        return PageResponse.of(page, AuditLogResponse::from);
    }

    /** Everything this doctor did, plus everything done to them (e.g. a patient granting them consent). */
    @GetMapping("/doctor/audit-log")
    public PageResponse<AuditLogResponse> myAuditLog(Pageable pageable, Authentication authentication) {
        CurrentUser me = currentUserService.resolveWithRole(authentication, "doctor role required", Role.DOCTOR);
        Page<AuditLog> page = auditLogs.findByActorIdOrSubjectOrderByAtDesc(me.id(), me.id(),
                atDescByDefault(pageable));
        return PageResponse.of(page, AuditLogResponse::from);
    }

    /**
     * Audit feeds are only ever read newest-first, and the derived queries
     * already carry {@code OrderByAtDesc}. An explicit client {@code sort}
     * still wins; this only fills in the default.
     */
    private static Pageable atDescByDefault(Pageable pageable) {
        return pageable.getSort().isSorted()
                ? pageable
                : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by(Sort.Direction.DESC, "at"));
    }

    private Map<String, String> usernamesOf(List<String> userIds) {
        List<String> ids = userIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return users.findAllById(ids).stream().collect(Collectors.toMap(User::getId, User::getUsername));
    }

    private List<ConsentResponse> enrich(List<ConsentLink> links) {
        List<String> userIds = links.stream()
                .flatMap(l -> java.util.stream.Stream.of(l.getPatientUserId(), l.getDoctorUserId()))
                .distinct()
                .toList();
        Map<String, String> usernamesById = users.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, User::getUsername));
        return links.stream()
                .map(l -> ConsentResponse.from(l, usernamesById.get(l.getPatientUserId()), usernamesById.get(l.getDoctorUserId())))
                .toList();
    }
}
