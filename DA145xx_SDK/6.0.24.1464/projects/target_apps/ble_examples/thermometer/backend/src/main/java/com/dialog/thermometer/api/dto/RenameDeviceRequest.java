package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.Size;

/**
 * Owner-scoped device rename. {@code null} or blank clears the label (the UI
 * then falls back to the model string); at most 64 characters, matching the
 * column and the model field's own budget.
 */
public record RenameDeviceRequest(@Size(max = 64, message = "label must be at most 64 characters") String label) {
}
