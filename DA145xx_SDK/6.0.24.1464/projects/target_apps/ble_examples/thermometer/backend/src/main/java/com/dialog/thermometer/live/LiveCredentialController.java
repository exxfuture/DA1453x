package com.dialog.thermometer.live;

import com.dialog.thermometer.api.dto.LiveCredentialsResponse;
import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.live.BrokerCredentialService.MintedCredential;
import com.dialog.thermometer.security.AuditDetailWriter;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Hands the caller a short-lived MQTT credential of their own, so the browser
 * can reach the broker directly for the live feed (architecture v3 §7) now that
 * the broker refuses anonymous connections.
 *
 * <p>Open to <b>any authenticated role</b> on purpose: the credential is scoped
 * to the caller's own topics by the broker ACLs
 * {@link BrokerCredentialService#mint} provisions, so there is nothing a role
 * check here would protect — a doctor minting one gets access to
 * {@code live/<their own id>/#} and nothing else. Under
 * {@code thermometer.security.enabled=false} (local profile) it mints for the
 * dev fallback user like every other endpoint.
 *
 * <p>Rate limiting is the default per-caller bucket (`RateLimitFilter`, 240/min
 * — no dedicated bucket), which is the throttle on how fast credentials can be
 * rotated. Each mint is audited as {@code live.credentials.mint}: this is the
 * one endpoint that hands out a secret, so "who asked for one, and when" has to
 * be answerable.
 */
@RestController
@RequestMapping("/api/live")
public class LiveCredentialController {

    private static final Logger log = LoggerFactory.getLogger(LiveCredentialController.class);

    private final BrokerCredentialService brokerCredentials;
    private final CurrentUserService currentUserService;
    private final AuditLogRepository auditLogs;
    private final AuditDetailWriter auditDetail;

    public LiveCredentialController(BrokerCredentialService brokerCredentials, CurrentUserService currentUserService,
                                     AuditLogRepository auditLogs, AuditDetailWriter auditDetail) {
        this.brokerCredentials = brokerCredentials;
        this.currentUserService = currentUserService;
        this.auditLogs = auditLogs;
        this.auditDetail = auditDetail;
    }

    /**
     * @return 200 with the credential, or <b>503</b> if the broker is
     *         unreachable or refuses the command — never a credential this
     *         service failed to provision, which would fail at connect time
     *         with no explanation
     */
    @PostMapping("/credentials")
    public ResponseEntity<LiveCredentialsResponse> mint(Authentication authentication) {
        CurrentUser me = currentUserService.resolve(authentication);
        MintedCredential credential;
        try {
            credential = brokerCredentials.mint(me.id());
        } catch (BrokerProvisioningException brokerUnavailable) {
            log.warn("Could not mint a live credential for {}: {}", me.id(), brokerUnavailable.getMessage());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "live credentials are unavailable — the broker could not be provisioned");
        }
        auditLogs.save(new AuditLog(me.id(), "live.credentials.mint", credential.username(),
                auditDetail.of("expiresAt", credential.expiresAt().toString())));

        // The body is a bearer secret: never store it in a shared cache, and
        // don't let a browser keep it in its disk cache either.
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(LiveCredentialsResponse.from(credential));
    }
}
