package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.live.BrokerCredentialService.MintedCredential;

import java.time.Instant;

/**
 * A short-lived MQTT credential for one browser session (see
 * {@code live/LiveCredentialController}). The broker now requires
 * authentication on the WebSocket listener too, so this is how the web/mobile
 * app gets onto the live feed at all.
 *
 * <p>The {@code password} is returned once and is not stored anywhere in this
 * service — only the broker has it after this response is written. Every mint
 * rotates it, so an older credential for the same user stops working.
 *
 * @param userId    {@code users.id}, the same id the live topic is keyed by
 *                  ({@code live/<userId>/…}) and that {@code GET /api/me}
 *                  returns as {@code id} — clients must use this, not the JWT
 *                  {@code sub}, for both the subscription and the publish topic
 * @param expiresAt when the scheduled sweep may delete this credential; mint
 *                  again before then (the app does so on every connect)
 */
public record LiveCredentialsResponse(String username, String password, String userId, Instant expiresAt) {

    public static LiveCredentialsResponse from(MintedCredential credential) {
        return new LiveCredentialsResponse(credential.username(), credential.password(), credential.userId(),
                credential.expiresAt());
    }
}
