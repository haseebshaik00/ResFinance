import { expect, type Page } from "@playwright/test";

const defaultAddress = `0x${"a".repeat(40)}`;

/** Sets up an unlocked ResWallet and an approved challenge for dashboard tests. */
export async function prepareWalletLogin(
  page: Page,
  actorAddress = defaultAddress,
): Promise<void> {
  await page.addInitScript((address) => {
    const identity = {
      public_key: "e2e-public-key",
      address,
    };
    window.addEventListener("message", (event) => {
      const request = event.data as {
        source?: string;
        version?: number;
        request_id?: string;
        type?: string;
        intent?: Record<string, unknown>;
      };
      if (
        event.source !== window ||
        request.source !== "resfinance-page" ||
        request.version !== 1 ||
        request.request_id === undefined
      ) {
        return;
      }
      if (request.type === "GET_STATUS") {
        window.postMessage(
          {
            source: "reswallet",
            version: 1,
            request_id: request.request_id,
            ok: true,
            result: { exists: true, unlocked: true, identity },
          },
          window.location.origin,
        );
        return;
      }
      if (
        request.type !== "SIGN_INTENT" ||
        request.intent?.action !== "auth.login"
      )
        return;
      const intent = request.intent;
      window.postMessage(
        {
          source: "reswallet",
          version: 1,
          request_id: request.request_id,
          ok: true,
          result: {
            version: 1,
            intent_id: intent.intent_id,
            action: intent.action,
            actor_public_key: identity.public_key,
            actor_address: identity.address,
            resource_id: intent.resource_id,
            parameters_hash: intent.parameters_hash,
            nonce: intent.nonce,
            issued_at: intent.issued_at,
            expires_at: intent.expires_at,
            origin: intent.origin,
            audience: intent.audience,
            network_id: intent.network_id,
            signature: "e2e-signature",
          },
        },
        window.location.origin,
      );
    });
  }, actorAddress);
  await page.route("**/api/v1/auth/challenges", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        challenge_id: "e2e-challenge",
        challenge: "c".repeat(32),
        expires_at: "2026-10-14T08:10:00Z",
        audience: "resfinance-api",
        network_id: "pinned-local-network",
      }),
    }),
  );
  await page.route("**/api/v1/auth/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "e2e-access-token",
        token_type: "Bearer",
        expires_at: "2026-10-14T08:10:00Z",
        actor_address: actorAddress,
      }),
    }),
  );
}

export async function approveWalletLogin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(
    page.locator('.auth-card[data-state="authenticated"]'),
  ).toBeVisible();
}
