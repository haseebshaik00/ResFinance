import { expect, test, type Page } from "@playwright/test";

async function prepareWelcomePage(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const request = event.data as {
        source?: string;
        version?: number;
        request_id?: string;
        type?: string;
      };
      if (
        event.source !== window ||
        request.source !== "resfinance-page" ||
        request.version !== 1 ||
        request.type !== "GET_STATUS" ||
        request.request_id === undefined
      ) {
        return;
      }
      window.postMessage(
        {
          source: "reswallet",
          version: 1,
          request_id: request.request_id,
          ok: true,
          result: {
            exists: true,
            unlocked: true,
            identity: {
              public_key: "landing-page-public-key",
              address: `0x${"a".repeat(40)}`,
            },
          },
        },
        window.location.origin,
      );
    });
  });
}

test("pairs wallet authentication with the animated architecture on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepareWelcomePage(page);
  await page.goto("/");

  await expect(page.locator('.auth-card[data-state="ready"]')).toBeVisible();
  const welcomeCopy = page.locator(".welcome-copy");
  const diagram = page.locator(".architecture-diagram-stage");
  const overlay = page.locator(".architecture-flow-overlay");
  const paths = page.locator(".architecture-flow-path");

  await expect(diagram.locator("img")).toBeVisible();
  await expect(overlay).toHaveCSS("pointer-events", "none");
  await expect(paths).toHaveCount(13);
  await expect(paths.first()).toHaveCSS(
    "animation-name",
    "architecture-data-flow",
  );

  const copyBox = await welcomeCopy.boundingBox();
  const diagramBox = await diagram.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(diagramBox).not.toBeNull();
  expect(diagramBox!.x).toBeGreaterThan(copyBox!.x + copyBox!.width);
  expect(diagramBox!.width / diagramBox!.height).toBeCloseTo(1533 / 1026, 2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);

  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(diagram.locator("img")).toBeVisible();
});

test("stacks the complete architecture below usable wallet controls on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareWelcomePage(page);
  await page.goto("/");

  const welcomeCopy = page.locator(".welcome-copy");
  const diagram = page.locator(".architecture-diagram-stage");
  const authSession = page.locator(".auth-session");
  const connectButton = page.getByRole("button", { name: "Connect Wallet" });
  await expect(connectButton).toBeEnabled();

  const copyBox = await welcomeCopy.boundingBox();
  const diagramBox = await diagram.boundingBox();
  const sessionBox = await authSession.boundingBox();
  const buttonBox = await connectButton.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(diagramBox).not.toBeNull();
  expect(sessionBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(diagramBox!.y).toBeGreaterThan(copyBox!.y + copyBox!.height);
  expect(buttonBox!.y).toBeGreaterThan(sessionBox!.y + sessionBox!.height);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("stops architecture flow highlights when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareWelcomePage(page);
  await page.goto("/");

  await expect(page.locator(".architecture-flow-path").first()).toHaveCSS(
    "animation-name",
    "none",
  );
});
