package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.Size;

/**
 * Admin-only device metadata edit — all fields optional, only non-null ones are
 * applied. Bounds match the columns (devices.model VARCHAR(64), fw_version
 * VARCHAR(32), label VARCHAR(64)) and the owner-facing
 * {@link RenameDeviceRequest}, so over-length input is a 400 rather than a 500
 * from the database.
 */
public record EditDeviceRequest(
        @Size(max = 64, message = "model must be at most 64 characters") String model,
        @Size(max = 32, message = "fwVersion must be at most 32 characters") String fwVersion,
        @Size(max = 64, message = "label must be at most 64 characters") String label) {
}
