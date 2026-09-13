package com.dialog.thermometer.annotation;

import com.dialog.thermometer.api.dto.AnnotationResponse;
import com.dialog.thermometer.api.dto.CreateAnnotationRequest;
import com.dialog.thermometer.api.dto.UpdateAnnotationRequest;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import com.dialog.thermometer.domain.MeasurementAnnotation;
import com.dialog.thermometer.domain.MeasurementAnnotationRepository;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.DeviceAccessGuard;
import com.dialog.thermometer.security.Role;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Customer-authored notes on their own readings ("took ibuprofen", "sensor
 * fell off"), rendered as chart markers.
 *
 * <p>Two different rules apply here and they are deliberately not the same
 * one: <b>reading</b> a device's notes follows normal device access (so a
 * consenting doctor sees their patient's context), while <b>writing</b> is
 * owner-only. Edits and deletes are scoped by author id in the query itself
 * (findByIdAndUserId), so a non-author gets 404 rather than 403 — a 403 would
 * confirm the note exists.
 *
 * <p>Paged with a plain {@code limit} rather than {@code Pageable}, matching
 * MeasurementController: these are hand-typed rows, tens per device, and a
 * page envelope would be ceremony over a list that fits in one response.
 */
@RestController
@RequestMapping("/api/annotations")
public class AnnotationController {

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;

    private final MeasurementAnnotationRepository annotations;
    private final DeviceRepository devices;
    private final DeviceAccessGuard accessGuard;
    private final CurrentUserService currentUserService;

    public AnnotationController(MeasurementAnnotationRepository annotations, DeviceRepository devices,
                                 DeviceAccessGuard accessGuard, CurrentUserService currentUserService) {
        this.annotations = annotations;
        this.devices = devices;
        this.accessGuard = accessGuard;
        this.currentUserService = currentUserService;
    }

    @PostMapping
    public ResponseEntity<AnnotationResponse> create(@Valid @RequestBody CreateAnnotationRequest request,
                                                      Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        if (me.role() != Role.CUSTOMER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only a customer can annotate their own readings");
        }
        requireOwnership(me, request.deviceBdAddr());

        MeasurementAnnotation saved = annotations.save(new MeasurementAnnotation(
                me.id(), request.deviceBdAddr(), request.tsFrom(), request.tsTo(), request.note()));
        return ResponseEntity.status(HttpStatus.CREATED).body(AnnotationResponse.from(saved));
    }

    @GetMapping
    public List<AnnotationResponse> list(@RequestParam String deviceBdAddr,
                                          @RequestParam(required = false) Instant from,
                                          @RequestParam(required = false) Instant to,
                                          @RequestParam(defaultValue = "" + DEFAULT_LIMIT) int limit,
                                          Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        accessGuard.requireReadAccess(me, deviceBdAddr);

        Instant effectiveFrom = from != null ? from : Instant.EPOCH;
        Instant effectiveTo = to != null ? to : Instant.now();
        int effectiveLimit = Math.max(1, Math.min(limit, MAX_LIMIT));

        return annotations
                .findByDeviceIdAndTsFromBetweenOrderByTsFromDesc(deviceBdAddr, effectiveFrom, effectiveTo,
                        PageRequest.of(0, effectiveLimit))
                .stream()
                .map(AnnotationResponse::from)
                .toList();
    }

    @PatchMapping("/{id}")
    public AnnotationResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateAnnotationRequest request,
                                      Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        MeasurementAnnotation annotation = annotations.findByIdAndUserId(id, me.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        if (request.tsTo() != null && request.tsTo().isBefore(annotation.getTsFrom())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tsTo must not be before tsFrom");
        }
        annotation.edit(annotation.getTsFrom(), request.tsTo(), request.note());
        return AnnotationResponse.from(annotations.save(annotation));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        MeasurementAnnotation annotation = annotations.findByIdAndUserId(id, me.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        annotations.delete(annotation);
        return ResponseEntity.noContent().build();
    }

    /**
     * Write access is stricter than {@link DeviceAccessGuard}'s read rule: a
     * consenting doctor may read a patient's notes but must not author notes
     * in the patient's voice (care notes are the doctor's own surface).
     */
    private void requireOwnership(CurrentUser me, String bdAddr) {
        boolean owned = devices.findByBdAddr(bdAddr).map(Device::getOwnerUserId).filter(me.id()::equals).isPresent();
        if (!owned) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "you do not own this device");
        }
    }
}
