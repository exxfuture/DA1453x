package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.ConsentLink;

import java.time.Instant;
import java.util.UUID;

public record ConsentResponse(
        UUID id,
        String patientUserId,
        String patientUsername,
        String doctorUserId,
        String doctorUsername,
        Instant grantedAt,
        Instant revokedAt) {

    public static ConsentResponse from(ConsentLink link, String patientUsername, String doctorUsername) {
        return new ConsentResponse(
                link.getId(),
                link.getPatientUserId(),
                patientUsername,
                link.getDoctorUserId(),
                doctorUsername,
                link.getGrantedAt(),
                link.getRevokedAt());
    }
}
