package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The patient a note is about is fixed at creation — only its text is editable. */
public record UpdateCareNoteRequest(@NotBlank @Size(max = 4000) String note) {
}
