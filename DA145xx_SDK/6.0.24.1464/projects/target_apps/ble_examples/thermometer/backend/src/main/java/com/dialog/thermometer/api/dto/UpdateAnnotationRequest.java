package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

/**
 * Edit of an existing note. {@code tsFrom} is intentionally not editable —
 * moving a note's anchor point would silently re-attach it to different
 * readings; delete and re-create instead.
 *
 * <p>{@code note} is required (a PATCH here is always "I want to reword
 * this"); {@code tsTo} is applied as sent, so passing null turns a span back
 * into a single-instant note.
 */
public record UpdateAnnotationRequest(
        @NotBlank @Size(max = 2000) String note,
        Instant tsTo) {
}
