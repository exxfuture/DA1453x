package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.Device;

import java.time.Instant;
import java.util.UUID;

/**
 * @param lastSeenAt   when this device last reported, denormalised onto the
 *                     devices row by ingest (V1__init.sql) — so
 *                     device lists can show staleness without one
 *                     hypertable lookup per device. Null until the first
 *                     reading arrives.
 * @param lastSeenType which measurement that last reading was
 *                     (temperature/humidity/battery)
 * @param label        customer-set friendly name; null when the owner hasn't
 *                     named the device (clients fall back to the model)
 */
public record DeviceResponse(
        UUID id,
        String bdAddr,
        String model,
        String label,
        String fwVersion,
        String ownerUserId,
        String ownerUsername,
        Instant claimedAt,
        Instant createdAt,
        Instant lastSeenAt,
        String lastSeenType) {

    public static DeviceResponse from(Device device) {
        return from(device, null);
    }

    /** ownerUsername is resolved separately (batch-looked-up from the users table) since Device has no relation to it. */
    public static DeviceResponse from(Device device, String ownerUsername) {
        return new DeviceResponse(
                device.getId(),
                device.getBdAddr(),
                device.getModel(),
                device.getLabel(),
                device.getFwVersion(),
                device.getOwnerUserId(),
                ownerUsername,
                device.getClaimedAt(),
                device.getCreatedAt(),
                device.getLastSeenAt(),
                device.getLastSeenType());
    }
}
