package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.User;

public record DoctorResponse(String id, String username, String displayName) {

    public static DoctorResponse from(User user) {
        return new DoctorResponse(user.getId(), user.getUsername(), user.getDisplayName());
    }
}
