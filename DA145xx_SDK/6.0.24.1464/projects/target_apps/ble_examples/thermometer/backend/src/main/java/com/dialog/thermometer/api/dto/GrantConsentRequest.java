package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.NotBlank;

public record GrantConsentRequest(@NotBlank String doctorUserId) {
}
