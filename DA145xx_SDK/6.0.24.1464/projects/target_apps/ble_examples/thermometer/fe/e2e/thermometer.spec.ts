import { expect, Page, test } from '@playwright/test';

/**
 * Real browser, real (dockerized) backend/broker/Keycloak — no mocks.
 * Requires `docker compose up` to be running first (see ../../README.md).
 *
 * Login/logout/password-change/forgot-password all go through Keycloak's
 * own hosted pages via real cross-origin browser navigation (Authorization
 * Code + PKCE, see ../src/auth/oidc.ts) — this suite drives those pages
 * directly rather than mocking them, since they're the actual security
 * boundary.
 */

// Demo account passwords — deploy/keycloak/realm-export.json (must satisfy the
// realm's password policy, so these aren't simply "password === username").
const DEMO_PASSWORDS: Record<string, string> = {
  customer1: 'Customer1!',
  customer2: 'Customer2!',
  doctor1: 'Doctor1!',
  admin1: 'Admin123!',
};

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function login(page: Page, username: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
  // Cross-origin redirect to Keycloak's own hosted login page.
  await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(DEMO_PASSWORDS[username]);
  await page.locator('#kc-login').click();
  // Back on the app, authenticated.
  await page.waitForURL(/localhost:8090\//);
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
}

/** Polls Mailpit (the local SMTP catcher Keycloak's realm is configured to
 *  use — see docker-compose.yml/realm-export.json) for the most recent
 *  email to `toEmail` and returns the Keycloak action-token link inside it. */
async function waitForResetLink(toEmail: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const list = (await listRes.json()) as { messages: MailpitMessage[] };
    const match = list.messages.find((m) => m.To?.some((t) => t.Address === toEmail));
    if (match) {
      const fullRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const full = (await fullRes.json()) as { HTML?: string; Text?: string };
      const body = full.HTML ?? full.Text ?? '';
      const linkMatch = body.match(/https?:\/\/[^\s"'<>]*login-actions\/action-token[^\s"'<>]*/);
      if (linkMatch) return linkMatch[0].replace(/&amp;/g, '&');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No password-reset email arrived for ${toEmail} within 20s`);
}

test('customer connects an ad-hoc simulated device, claims it, and sees it on the dashboard', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await login(page, 'customer1');
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole('link', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a thermometer' })).toBeVisible();

  await page.getByRole('button', { name: 'Connect (Simulated Device)' }).click();
  await expect(page.getByText(/°C/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('DLG_THRM (simulated)')).toBeVisible();

  await page.getByRole('button', { name: 'Claim this device to my account' }).click();
  await expect(page.getByText('Claimed ✓')).toBeVisible({ timeout: 5000 });

  await expect(page.getByText('No live events yet.')).toBeHidden({ timeout: 15_000 });

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('No readings in this range yet.')).toBeHidden({ timeout: 15_000 });

  const relevantErrors = consoleErrors.filter((e) => !e.includes('favicon'));
  expect(relevantErrors, `unexpected browser console errors: ${relevantErrors.join('\n')}`).toHaveLength(0);
});

test('customer claims a fleet device, grants doctor consent, and doctor/admin see it', async ({ page }) => {
  // A doctor only appears in GET /api/doctors (and so is grantable) once their
  // local `users` row is JIT-provisioned by a first authenticated request —
  // see backend/README.md "Roles & identity". Log doctor1 in once first, same
  // as they'd sign in at least once for real before a patient could know to
  // grant them access.
  await login(page, 'doctor1');
  await expect(page).toHaveURL(/\/dashboard/);
  await logout(page);

  // customer2 claims one of the always-on simulated fleet devices (docker-compose gateway-1..4)
  await login(page, 'customer2');
  await page.getByRole('link', { name: 'Devices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();

  const claimButtons = page.getByRole('button', { name: 'Claim' });
  const somethingToClaim = await claimButtons.first().isVisible().catch(() => false);
  if (!somethingToClaim) {
    // Every fleet device is already claimed — inevitable once this suite has
    // run against the same persisted volume a few times (each run claims one).
    // Free one of customer2's own so the scenario stays self-sufficient; the
    // available-devices poll picks it up within its 5 s cadence.
    await page.getByRole('button', { name: 'Release' }).first().click();
    await expect(claimButtons.first()).toBeVisible({ timeout: 15_000 });
  }
  await claimButtons.first().click();
  await expect(page.getByText('Your device')).toBeVisible({ timeout: 10_000 });

  // Grant doctor1 access to customer2's data. Selects by index, not by
  // visible label — the label is the doctor's displayName when set (e.g. a
  // real person's own local dev environment may have customized it), not
  // necessarily their username; doctor1 is the only seeded doctor account,
  // so "the first real option" (index 0 is the "Select a doctor…"
  // placeholder) is unambiguous.
  //
  // The grant UI only renders while there is something left to grant: this
  // suite runs against a *persisting* Postgres volume, so on any stack where
  // an earlier run already granted doctor1, customer2's Settings page shows
  // doctor1 under "My doctors" instead. Either way the consent this scenario
  // needs exists — assert that and move on.
  await page.getByRole('link', { name: 'Settings' }).click();
  const grantSelect = page.getByLabel('Grant access to');
  if (await grantSelect.isVisible().catch(() => false)) {
    await grantSelect.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Grant' }).click();
  }
  await expect(page.getByText('doctor1')).toBeVisible({ timeout: 10_000 });
  await logout(page);

  // doctor1's dashboard (their home page — DoctorDashboardPage's fleet
  // overview) should now list customer2 as a patient; click through to the
  // chart.
  await login(page, 'doctor1');
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('row', { name: /customer2/ }).getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(/\/patients/);
  await expect(page.getByText('No readings in this range yet.')).toBeHidden({ timeout: 20_000 });
  await logout(page);

  // admin1 should see the user, their claimed device, and the relationship
  await login(page, 'admin1');
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole('cell', { name: 'customer2', exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('link', { name: 'Devices', exact: true }).click();
  // .first(): against persisting data a demo account may own several devices,
  // each rendering its own row/cell — any one confirms ownership is visible.
  await expect(page.getByRole('cell', { name: 'customer2', exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // The relationships tab is a full audit trail (every grant/revoke ever,
  // not just currently-active links — see AdminController#adminConsents),
  // so a demo account with prior history can have more than one row here;
  // .first() just confirms a relationship involving these two exists.
  await page.getByRole('link', { name: 'Relationships', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'customer2', exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('cell', { name: 'doctor1' }).first()).toBeVisible();
});

/**
 * Best-effort recovery, meant for a `finally` block: tries each of
 * `candidatePasswords` in turn (whichever currently works — a mid-test
 * failure could have left the account on either the old or the new
 * password) and, once logged in, uses the standard change-password flow to
 * set it back to `targetPassword`. Never throws — a cleanup step failing
 * shouldn't mask the real test failure — but logs loudly if it can't
 * recover, since that means a demo account's real password now disagrees
 * with DEMO_PASSWORDS for every later run.
 */
async function revertPasswordViaStandardFlow(page: Page, username: string, candidatePasswords: string[]) {
  const [targetPassword] = candidatePasswords;
  try {
    await page.goto('/');
    const signOut = page.getByRole('button', { name: 'Sign out' });
    if (await signOut.isVisible().catch(() => false)) {
      await signOut.click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    }

    for (const candidate of candidatePasswords) {
      await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
      await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
      await page.locator('#username').fill(username);
      await page.locator('#password').fill(candidate);
      await page.locator('#kc-login').click();
      const signedIn = await page
        .waitForURL(/localhost:8090\//, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!signedIn) {
        await page.goto('/');
        continue;
      }
      if (candidate === targetPassword) {
        return; // already at the target password — nothing to revert
      }
      await page.getByRole('link', { name: 'Settings' }).click();
      await page.getByRole('button', { name: 'Change password' }).click();
      await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
      await page.locator('#password-new').fill(targetPassword);
      await page.locator('#password-confirm').fill(targetPassword);
      await page.getByRole('button', { name: 'Submit' }).click();
      await page.waitForURL(/localhost:8090\//);
      return;
    }
    console.error(
      `[cleanup] could not sign in as ${username} with any candidate password (tried: ${candidatePasswords.join(', ')}) — its real password may now be out of sync with DEMO_PASSWORDS`,
    );
  } catch (err) {
    console.error(`[cleanup] failed to revert ${username}'s password:`, err);
  }
}

test("customer changes their password via Keycloak's own form, and the new password actually works", async ({
  page,
}) => {
  const TEMP_PASSWORD = 'TemporaryPass1!';
  try {
    await login(page, 'customer1');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Change password' }).click();

    // Keycloak's UPDATE_PASSWORD required action — already authenticated,
    // so it goes straight to the new-password form, no re-login.
    await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
    await expect(page.getByRole('heading', { name: 'Update password' })).toBeVisible();
    await page.locator('#password-new').fill(TEMP_PASSWORD);
    await page.locator('#password-confirm').fill(TEMP_PASSWORD);
    await page.getByRole('button', { name: 'Submit' }).click();

    // Back on the app, still signed in (redirect_uri is always the app
    // root, then the role-based Home redirect sends a customer to /dashboard).
    await page.waitForURL(/localhost:8090\//);
    await expect(page).toHaveURL(/\/dashboard/);

    await logout(page);

    // Old password should now be rejected...
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
    await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
    await page.locator('#username').fill('customer1');
    await page.locator('#password').fill(DEMO_PASSWORDS.customer1);
    await page.locator('#kc-login').click();
    await expect(page.getByText(/Invalid username or password/i)).toBeVisible();

    // ...and the new one should work.
    await page.locator('#username').fill('customer1');
    await page.locator('#password').fill(TEMP_PASSWORD);
    await page.locator('#kc-login').click();
    await page.waitForURL(/localhost:8090\//);
    await expect(page).toHaveURL(/\/dashboard/);
  } finally {
    await revertPasswordViaStandardFlow(page, 'customer1', [DEMO_PASSWORDS.customer1, TEMP_PASSWORD]);
  }
});

test('forgot password: Keycloak sends a real reset email and the reset link changes the password', async ({
  page,
}) => {
  const TEMP_PASSWORD = 'ResetFlow1!';
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
    await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
    await page.getByRole('link', { name: 'Forgot Password?' }).click();

    await expect(page.locator('#username')).toBeVisible();
    await page.locator('#username').fill('admin1');
    await page.getByRole('button', { name: 'Submit' }).click();
    // Keycloak shows the same "check your email" message whether or not the
    // account exists (no user enumeration) — this is the confirmation screen.
    await expect(page.getByText(/you should receive an email/i)).toBeVisible();

    const resetLink = await waitForResetLink('admin1@example.test');
    await page.goto(resetLink);

    await expect(page.getByRole('heading', { name: 'Update password' })).toBeVisible();
    await page.locator('#password-new').fill(TEMP_PASSWORD);
    await page.locator('#password-confirm').fill(TEMP_PASSWORD);
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForURL(/localhost:8090\//);
    await expect(page).toHaveURL(/\/admin/);

    await logout(page);

    // New password from the reset flow works...
    await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
    await page.waitForURL(/localhost:8082\/realms\/thermometer\//);
    await page.locator('#username').fill('admin1');
    await page.locator('#password').fill(TEMP_PASSWORD);
    await page.locator('#kc-login').click();
    await page.waitForURL(/localhost:8090\//);
    await expect(page).toHaveURL(/\/admin/);
  } finally {
    await revertPasswordViaStandardFlow(page, 'admin1', [DEMO_PASSWORDS.admin1, TEMP_PASSWORD]);
  }
});
