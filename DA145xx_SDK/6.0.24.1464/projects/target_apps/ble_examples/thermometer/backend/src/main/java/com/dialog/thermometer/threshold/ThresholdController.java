package com.dialog.thermometer.threshold;

import com.dialog.thermometer.api.dto.ThresholdResponse;
import com.dialog.thermometer.api.dto.UpsertThresholdRequest;
import com.dialog.thermometer.domain.AlertThreshold;
import com.dialog.thermometer.domain.AlertThresholdRepository;
import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.ConsentLinkRepository;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;

/**
 * Read and edit temperature-tier scales at the three scopes of
 * {@link AlertThreshold}.
 *
 * <p>The routes are split by scope on purpose — {@code /mine} (customer),
 * {@code /patient/{id}} (doctor override), {@code /system} (admin) — rather
 * than one endpoint taking a {@code scope} parameter. Each route can then
 * carry exactly one authorization rule that is obvious from its own body; a
 * single polymorphic endpoint would put all three rules in one branchy check,
 * which is where a scope-confusion bug would live.
 *
 * <p>Reads return 204 when nothing is stored at that scope, so the UI can
 * distinguish "not configured, inheriting" from "configured to these values"
 * — {@code GET /resolved} is the endpoint for "what is actually in effect".
 */
@RestController
@RequestMapping("/api/thresholds")
public class ThresholdController {

    private final AlertThresholdRepository thresholds;
    private final AlertThresholdService thresholdService;
    private final ConsentLinkRepository consentLinks;
    private final AuditLogRepository auditLogs;
    private final CurrentUserService currentUserService;

    public ThresholdController(AlertThresholdRepository thresholds, AlertThresholdService thresholdService,
                                ConsentLinkRepository consentLinks, AuditLogRepository auditLogs,
                                CurrentUserService currentUserService) {
        this.thresholds = thresholds;
        this.thresholdService = thresholdService;
        this.consentLinks = consentLinks;
        this.auditLogs = auditLogs;
        this.currentUserService = currentUserService;
    }

    /**
     * The scale actually in effect for a subject, and where it came from.
     * Omitting {@code subjectUserId} means "me". A doctor asking about a
     * patient gets the scale <i>they</i> see, i.e. including their own
     * override — that is the point of the {@code viewingDoctorId} argument.
     */
    @GetMapping("/resolved")
    public ThresholdResponse resolved(@RequestParam(required = false) String subjectUserId,
                                       Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        String subject = subjectUserId != null && !subjectUserId.isBlank() ? subjectUserId : me.id();

        switch (me.role()) {
            case CUSTOMER -> {
                if (!me.id().equals(subject)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "you can only read your own thresholds");
                }
            }
            case DOCTOR -> requireActiveConsent(me, subject);
            case ADMIN -> {
                // unrestricted
            }
        }

        String viewingDoctorId = me.role() == Role.DOCTOR ? me.id() : null;
        return ThresholdResponse.from(thresholdService.resolve(subject, viewingDoctorId));
    }

    // ---- customer: own scale -------------------------------------------

    @GetMapping("/mine")
    public ResponseEntity<ThresholdResponse> mine(Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.CUSTOMER, "only a customer has a personal threshold scale");
        return respond(thresholds.findByScopeAndSubjectUserId(AlertThreshold.SCOPE_SELF, me.id()));
    }

    @PutMapping("/mine")
    public ThresholdResponse upsertMine(@Valid @RequestBody UpsertThresholdRequest request,
                                         Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.CUSTOMER, "only a customer has a personal threshold scale");
        AlertThreshold row = thresholds.findByScopeAndSubjectUserId(AlertThreshold.SCOPE_SELF, me.id())
                .orElseGet(() -> new AlertThreshold(AlertThreshold.SCOPE_SELF, me.id(), me.id(),
                        request.normalStartC(), request.elevatedStartC(), request.feverStartC(), request.highFeverStartC()));
        row.updateBoundaries(request.normalStartC(), request.elevatedStartC(), request.feverStartC(), request.highFeverStartC(),
                me.id());
        return ThresholdResponse.from(thresholds.save(row));
    }

    @DeleteMapping("/mine")
    public ResponseEntity<Void> clearMine(Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.CUSTOMER, "only a customer has a personal threshold scale");
        thresholds.findByScopeAndSubjectUserId(AlertThreshold.SCOPE_SELF, me.id()).ifPresent(thresholds::delete);
        return ResponseEntity.noContent().build();
    }

    // ---- doctor: per-patient override ----------------------------------

    @GetMapping("/patient/{patientUserId}")
    public ResponseEntity<ThresholdResponse> patientOverride(@PathVariable String patientUserId,
                                                              Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.DOCTOR, "only a doctor can set a patient override");
        requireActiveConsent(me, patientUserId);
        return respond(thresholds.findByScopeAndSubjectUserIdAndSetByUserId(AlertThreshold.SCOPE_DOCTOR_OVERRIDE,
                patientUserId, me.id()));
    }

    @PutMapping("/patient/{patientUserId}")
    public ThresholdResponse upsertPatientOverride(@PathVariable String patientUserId,
                                                    @Valid @RequestBody UpsertThresholdRequest request,
                                                    Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.DOCTOR, "only a doctor can set a patient override");
        requireActiveConsent(me, patientUserId);

        AlertThreshold row = thresholds
                .findByScopeAndSubjectUserIdAndSetByUserId(AlertThreshold.SCOPE_DOCTOR_OVERRIDE, patientUserId, me.id())
                .orElseGet(() -> new AlertThreshold(AlertThreshold.SCOPE_DOCTOR_OVERRIDE, patientUserId, me.id(),
                        request.normalStartC(), request.elevatedStartC(), request.feverStartC(), request.highFeverStartC()));
        row.updateBoundaries(request.normalStartC(), request.elevatedStartC(), request.feverStartC(), request.highFeverStartC(),
                me.id());
        AlertThreshold saved = thresholds.save(row);
        // Changing the scale a patient's readings are judged against is a
        // clinically meaningful act by someone other than the patient, so it
        // is auditable — unlike a patient editing their own.
        auditLogs.save(new AuditLog(me.id(), "threshold.doctor_override.set", patientUserId, null));
        return ThresholdResponse.from(saved);
    }

    @DeleteMapping("/patient/{patientUserId}")
    public ResponseEntity<Void> clearPatientOverride(@PathVariable String patientUserId,
                                                      Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.DOCTOR, "only a doctor can clear their patient override");
        requireActiveConsent(me, patientUserId);
        thresholds.findByScopeAndSubjectUserIdAndSetByUserId(AlertThreshold.SCOPE_DOCTOR_OVERRIDE, patientUserId,
                me.id()).ifPresent(row -> {
                    thresholds.delete(row);
                    auditLogs.save(new AuditLog(me.id(), "threshold.doctor_override.clear", patientUserId, null));
                });
        return ResponseEntity.noContent().build();
    }

    // ---- admin: system default -----------------------------------------

    @GetMapping("/system")
    public ResponseEntity<ThresholdResponse> system(Authentication authentication) {
        requireRole(authentication, Role.ADMIN, "admin role required");
        return respond(thresholds.findByScope(AlertThreshold.SCOPE_SYSTEM));
    }

    /**
     * No DELETE counterpart: removing the system row would silently drop
     * every user without a personal scale back to the hardcoded
     * {@link AlertThresholdService#FALLBACK}. Overwrite it instead.
     */
    @PutMapping("/system")
    public ThresholdResponse upsertSystem(@Valid @RequestBody UpsertThresholdRequest request,
                                           Authentication authentication) {
        CurrentUser me = requireRole(authentication, Role.ADMIN, "admin role required");
        AlertThreshold row = thresholds.findByScope(AlertThreshold.SCOPE_SYSTEM)
                .orElseGet(() -> new AlertThreshold(AlertThreshold.SCOPE_SYSTEM, null, me.id(),
                        request.normalStartC(), request.elevatedStartC(), request.feverStartC(), request.highFeverStartC()));
        row.updateBoundaries(request.normalStartC(), request.elevatedStartC(), request.feverStartC(), request.highFeverStartC(),
                me.id());
        AlertThreshold saved = thresholds.save(row);
        auditLogs.save(new AuditLog(me.id(), "threshold.system.set", null, null));
        return ThresholdResponse.from(saved);
    }

    private static ResponseEntity<ThresholdResponse> respond(Optional<AlertThreshold> row) {
        return row.map(ThresholdResponse::from).map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    private CurrentUser requireRole(Authentication authentication, Role required, String message) {
        CurrentUser me = currentUserService.resolve(authentication);
        if (me.role() != required) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, message);
        }
        return me;
    }

    private void requireActiveConsent(CurrentUser doctor, String patientUserId) {
        if (!consentLinks.existsByPatientUserIdAndDoctorUserIdAndRevokedAtIsNull(patientUserId, doctor.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "no active consent from this patient");
        }
    }
}
