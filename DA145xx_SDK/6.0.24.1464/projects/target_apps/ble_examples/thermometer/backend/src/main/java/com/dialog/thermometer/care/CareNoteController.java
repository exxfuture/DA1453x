package com.dialog.thermometer.care;

import com.dialog.thermometer.api.dto.CareNoteResponse;
import com.dialog.thermometer.api.dto.CreateCareNoteRequest;
import com.dialog.thermometer.api.dto.UpdateCareNoteRequest;
import com.dialog.thermometer.domain.CareNote;
import com.dialog.thermometer.domain.CareNoteRepository;
import com.dialog.thermometer.domain.ConsentLinkRepository;
import com.dialog.thermometer.domain.User;
import com.dialog.thermometer.domain.UserRepository;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import jakarta.validation.Valid;
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

import java.util.List;
import java.util.UUID;

/**
 * A doctor's clinical notes about a patient.
 *
 * <p><b>Doctor-private by design</b> (V1__init.sql): consent in this
 * system only ever flows patient → doctor, so there is no patient read path
 * here at all — not a missing feature, a deliberate boundary. Admins get a
 * separate read-only compliance view in AdminController; a doctor never sees
 * another doctor's notes, enforced by scoping every lookup on
 * {@code doctorUserId} in the query itself rather than checking after the
 * fetch.
 *
 * <p>Writing requires active consent, but <b>reading your own notes does
 * not</b>: once consent is revoked a doctor may no longer add to the record,
 * yet the notes they already authored remain theirs to read. Deleting them on
 * revocation would destroy a clinical record, which is the worse failure.
 */
@RestController
@RequestMapping("/api/care-notes")
public class CareNoteController {

    private final CareNoteRepository careNotes;
    private final ConsentLinkRepository consentLinks;
    private final UserRepository users;
    private final CurrentUserService currentUserService;

    public CareNoteController(CareNoteRepository careNotes, ConsentLinkRepository consentLinks, UserRepository users,
                               CurrentUserService currentUserService) {
        this.careNotes = careNotes;
        this.consentLinks = consentLinks;
        this.users = users;
        this.currentUserService = currentUserService;
    }

    @PostMapping
    public ResponseEntity<CareNoteResponse> create(@Valid @RequestBody CreateCareNoteRequest request,
                                                    Authentication authentication) {
        CurrentUser me = requireDoctor(authentication);
        if (!consentLinks.existsByPatientUserIdAndDoctorUserIdAndRevokedAtIsNull(request.patientUserId(), me.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "no active consent from this patient");
        }
        CareNote saved = careNotes.save(new CareNote(me.id(), request.patientUserId(), request.note()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(CareNoteResponse.from(saved, me.username(), usernameOf(request.patientUserId())));
    }

    @GetMapping
    public List<CareNoteResponse> list(@RequestParam String patientUserId, Authentication authentication) {
        CurrentUser me = requireDoctor(authentication);
        String patientUsername = usernameOf(patientUserId);
        return careNotes.findByDoctorUserIdAndPatientUserIdOrderByCreatedAtDesc(me.id(), patientUserId).stream()
                .map(note -> CareNoteResponse.from(note, me.username(), patientUsername))
                .toList();
    }

    @PatchMapping("/{id}")
    public CareNoteResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateCareNoteRequest request,
                                    Authentication authentication) {
        CurrentUser me = requireDoctor(authentication);
        CareNote note = requireOwnNote(id, me);
        note.edit(request.note());
        return CareNoteResponse.from(careNotes.save(note), me.username(), usernameOf(note.getPatientUserId()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, Authentication authentication) {
        CurrentUser me = requireDoctor(authentication);
        careNotes.delete(requireOwnNote(id, me));
        return ResponseEntity.noContent().build();
    }

    private CurrentUser requireDoctor(Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        if (me.role() != Role.DOCTOR) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "only doctors keep care notes");
        }
        return me;
    }

    /** 404 rather than 403 for another doctor's note — a 403 would confirm it exists. */
    private CareNote requireOwnNote(UUID id, CurrentUser me) {
        return careNotes.findByIdAndDoctorUserId(id, me.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private String usernameOf(String userId) {
        return users.findById(userId).map(User::getUsername).orElse(null);
    }
}
