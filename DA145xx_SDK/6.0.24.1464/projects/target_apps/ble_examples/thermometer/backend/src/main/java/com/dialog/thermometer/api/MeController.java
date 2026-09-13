package com.dialog.thermometer.api;

import com.dialog.thermometer.api.dto.MeResponse;
import com.dialog.thermometer.api.dto.UpdateMeRequest;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/**
 * The caller's own profile. GET is also the JIT-provisioning bootstrap the
 * frontend calls right after login (see CurrentUserService) — username/email/
 * role always reflect the Keycloak JWT; displayName and temperatureUnit are
 * owned locally.
 *
 * <p>Password change/reset is not part of this API — it's handled entirely
 * by Keycloak's own hosted UI via browser redirects (Authorization Code +
 * PKCE login, {@code kc_action=UPDATE_PASSWORD} for an in-session change,
 * the realm's built-in "Forgot password?" flow for a logged-out reset). See
 * {@code fe/src/auth/oidc.ts} and {@code backend/README.md} "Roles &
 * identity".
 */
@RestController
@RequestMapping("/api/me")
public class MeController {

    private final CurrentUserService currentUserService;

    public MeController(CurrentUserService currentUserService) {
        this.currentUserService = currentUserService;
    }

    @GetMapping
    public MeResponse me(Authentication authentication) {
        return MeResponse.from(currentUserService.resolve(authentication));
    }

    @PatchMapping
    public MeResponse update(@Valid @RequestBody UpdateMeRequest request, Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        return MeResponse.from(currentUserService.updateProfile(me, request.displayName(), request.temperatureUnit()));
    }
}
