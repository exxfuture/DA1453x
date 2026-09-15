package com.dialog.thermometer.rollout;

import com.dialog.thermometer.api.dto.CreateRolloutRequest;
import com.dialog.thermometer.api.dto.PageResponse;
import com.dialog.thermometer.api.dto.RolloutDetailResponse;
import com.dialog.thermometer.api.dto.RolloutResponse;
import com.dialog.thermometer.api.dto.RolloutStatusRequest;
import com.dialog.thermometer.api.dto.RolloutSummaryResponse;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DIY OTA rollout orchestration (architecture v3 §10). Admin creates a
 * rollout targeting a percentage of a chip model's fleet; collectors poll
 * for a pending update on device check-in and report back success/failure,
 * which can auto-abort the rollout past its error threshold.
 *
 * <p>The two collector endpoints ({@code GET /pending}, {@code POST
 * /{id}/status}) are outside the JWT filter chain (SecurityConfig) because
 * collectors have no user identity; they authenticate with a shared
 * {@code X-Device-Token} secret instead. <b>Known tradeoff:</b> that is one
 * bearer secret for the whole fleet, not per-device credentials — leaking it
 * from any collector lets the holder read firmware metadata and report fake
 * install status for arbitrary devices. Per-device credentials need
 * device-provisioning infrastructure that doesn't exist yet (the gateway's
 * {@code internal/auth.TokenProvider} is the seam it will plug into); tracked
 * in ../proposals.md rather than left implicit.
 */
@RestController
@RequestMapping("/api/rollouts")
public class RolloutController {

    private final RolloutService rolloutService;
    private final CurrentUserService currentUserService;
    private final String collectorToken;

    public RolloutController(RolloutService rolloutService, CurrentUserService currentUserService,
                              @Value("${thermometer.device.collector-token}") String collectorToken) {
        this.rolloutService = rolloutService;
        this.currentUserService = currentUserService;
        this.collectorToken = collectorToken;
    }

    @PostMapping
    public ResponseEntity<RolloutResponse> create(@Valid @RequestBody CreateRolloutRequest request,
                                                   Authentication authentication) {
        requireAdmin(authentication);
        Rollout rollout = new Rollout(
                request.version(),
                request.chipModel(),
                request.imageUrl(),
                request.deltaUrl(),
                request.sha256(),
                request.signature(),
                request.groupPercentage(),
                request.abortThresholdPct());
        rollout = rolloutService.create(rollout);
        return ResponseEntity.status(201).body(RolloutResponse.from(rollout));
    }

    /**
     * Admin rollout list, newest first. Progress counts for the whole page
     * come from a single grouped query (RolloutService.progressOf).
     *
     * <p>Mapped before {@code /{id}} below only in reading order — Spring
     * matches the literal {@code /pending} path ahead of the {@code {id}}
     * template regardless, so the collector endpoint is never shadowed.
     */
    @GetMapping
    public PageResponse<RolloutSummaryResponse> list(Pageable pageable, Authentication authentication) {
        requireAdmin(authentication);
        Page<Rollout> page = rolloutService.list(pageable);
        Map<UUID, Map<String, Long>> progress = rolloutService.progressOf(
                page.getContent().stream().map(Rollout::getId).toList());
        return PageResponse.of(page,
                page.getContent().stream()
                        .map(rollout -> RolloutSummaryResponse.from(rollout, progress.get(rollout.getId())))
                        .toList());
    }

    @GetMapping("/{id}")
    public RolloutDetailResponse detail(@PathVariable UUID id, Authentication authentication) {
        requireAdmin(authentication);
        Rollout rollout = rolloutService.find(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        List<RolloutTarget> targets = rolloutService.targetsOf(id);
        Map<String, Long> statusCounts = rolloutService.progressOf(List.of(id)).getOrDefault(id, Map.of());
        return new RolloutDetailResponse(
                RolloutSummaryResponse.from(rollout, statusCounts),
                targets.stream().map(RolloutDetailResponse.Target::from).toList());
    }

    @GetMapping("/pending")
    public ResponseEntity<RolloutResponse> pending(@RequestParam String chipModel,
                                                    @RequestParam(required = false) String currentVersion,
                                                    @RequestParam String bdAddr,
                                                    @RequestHeader(value = "X-Device-Token", required = false)
                                                    String deviceToken) {
        requireCollectorToken(deviceToken);
        return rolloutService.findPending(chipModel, currentVersion, bdAddr)
                .map(RolloutResponse::from)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.noContent().build());
    }

    @PostMapping("/{id}/status")
    public ResponseEntity<Void> reportStatus(@PathVariable UUID id, @Valid @RequestBody RolloutStatusRequest request,
                                              @RequestHeader(value = "X-Device-Token", required = false)
                                              String deviceToken) {
        requireCollectorToken(deviceToken);
        rolloutService.reportStatus(id, request.bdAddr(), request.status(), request.errorDetail());
        return ResponseEntity.noContent().build();
    }

    private void requireAdmin(Authentication authentication) {
        if (currentUserService.resolve(authentication).role() != Role.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "admin role required for rollout management");
        }
    }

    /**
     * Constant-time comparison so a caller can't recover the token one byte
     * at a time from response timing. A missing header, or a blank configured
     * token (which would otherwise mean "everyone is authenticated"), is
     * rejected the same way as a wrong one — no distinguishing message.
     */
    private void requireCollectorToken(String token) {
        boolean valid = token != null && collectorToken != null && !collectorToken.isBlank()
                && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                        collectorToken.getBytes(StandardCharsets.UTF_8));
        if (!valid) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing or invalid X-Device-Token");
        }
    }
}
