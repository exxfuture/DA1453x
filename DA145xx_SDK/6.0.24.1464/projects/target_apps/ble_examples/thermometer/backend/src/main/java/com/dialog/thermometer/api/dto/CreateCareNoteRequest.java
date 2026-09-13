package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateCareNoteRequest(
        @NotBlank @Size(max = 64) String patientUserId,
        @NotBlank @Size(max = 4000) String note) {
}
