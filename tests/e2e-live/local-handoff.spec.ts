import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const enabled = process.env.RESFINANCE_LOCAL_HANDOFF === "1";
const root = resolve(process.cwd(), "..");
const extension = resolve(root, "reswallet/dist");
const python = resolve(root, ".venv/bin/python");
const lifecycle = ["-m", "scripts.milestone9.local_handoff"];
const password = "local-handoff-only-password";

test.skip(
  !enabled,
  "run with npm run test:e2e:local against the Milestone 9 stack",
);

test("real ResWallet and services preserve the local journey through restart", async () => {
  const first = await walletContext("owner");
  const second = await walletContext("member");
  try {
    const owner = await initializeWallet(first, "owner");
    const member = await initializeWallet(second, "member");
    console.log("milestone9:e2e wallets initialized");
    await proveWrongOriginHasNoExtension(first);
    const ownerPage = await authenticate(first);
    const memberPage = await authenticate(second);
    console.log("milestone9:e2e both sessions authenticated");

    await seedFinance(ownerPage);
    console.log("milestone9:e2e finance records saved");
    const groupName = await createAndSettleGroup(
      ownerPage,
      memberPage,
      member.address,
    );
    console.log("milestone9:e2e group settled with tamper and replay rejected");

    const financeProjection = waitForGet(ownerPage, /\/finance\/overview\?/);
    await ownerPage.getByRole("link", { name: "Personal Finance" }).click();
    const finance = (await (await financeProjection).json()) as {
      obligations: Array<{
        amount: { minor_units: number };
        contract_receipt: string;
        direction: string;
        settled: boolean;
      }>;
      summary: { savings: { available: { minor_units: number } } };
    };
    expect(finance.summary.savings.available.minor_units).toBe(400_000);
    expect(finance.obligations).toContainEqual(
      expect.objectContaining({
        amount: { currency: "USD", minor_units: 6_000 },
        direction: "receivable",
        settled: true,
        contract_receipt: expect.any(String),
      }),
    );

    const forecastResponse = waitForGet(ownerPage, /\/crypto\/forecast$/);
    const recommendationResponse = waitForPost(
      ownerPage,
      /\/crypto\/recommendations$/,
    );
    await ownerPage
      .getByRole("link", { name: "Crypto Intelligence", exact: true })
      .click();
    const forecast = (await (await forecastResponse).json()) as {
      assets: Array<{ asset: string; predicted_prices: string[] }>;
      forecast_dates_utc: string[];
      model_name: string;
    };
    expect(forecast.model_name).toContain("MSPCIFormer");
    expect(forecast.forecast_dates_utc).toHaveLength(7);
    expect(forecast.assets).toHaveLength(3);
    expect(forecast.assets.every((item) => item.predicted_prices.length === 7)).toBe(
      true,
    );
    await expect(
      ownerPage.getByRole("heading", { name: "Seven-Day Price Outlook" }),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Save risk profile" }).click();
    const recommendation = (await (await recommendationResponse).json()) as {
      allocations: Array<{ amount: { minor_units: number } }>;
      capital: { minor_units: number };
      cash_reserve: { amount: { minor_units: number } };
      risk_score: number;
    };
    expect(recommendation.capital.minor_units).toBe(100_000);
    expect(allocationTotal(recommendation)).toBe(100_000);
    expect(recommendation.risk_score).toBe(50);
    await expect(ownerPage.getByText(/Score 50/)).toBeVisible();
    await expect(
      ownerPage.getByRole("heading", { name: "Portfolio Allocation" }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("heading", { name: "Seven-Day Price Outlook" }),
    ).toBeVisible();
    console.log(
      "milestone9:e2e seven-day forecast and questionnaire-led allocation verified",
    );

    await ownerPage.getByRole("link", { name: "Personal Finance" }).click();
    await ownerPage.locator("#smart-insights").scrollIntoViewIfNeeded();
    await ownerPage
      .getByRole("textbox", { name: "Question" })
      .fill("Which recorded budgets need attention?");
    const budgetInsight = waitForPost(ownerPage, /\/insights\/query$/, 120_000);
    await ownerPage.getByRole("button", { name: "Explain" }).click();
    expect((await budgetInsight).status()).toBe(200);
    await expect(
      ownerPage.locator('[aria-label="Evidence used"]'),
    ).toBeVisible();
    await ownerPage
      .getByRole("textbox", { name: "Question" })
      .fill("Transfer my crypto and settle everything for me");
    const unsafeInsight = waitForPost(ownerPage, /\/insights\/query$/, 120_000);
    await ownerPage.getByRole("button", { name: "Explain" }).click();
    expect((await unsafeInsight).status()).toBe(200);
    await expect(
      ownerPage.getByRole("heading", { name: /I cannot write records/i }),
    ).toBeVisible();
    console.log("milestone9:e2e insight boundaries verified");

    const beforeRestart = await ownerPage.locator("main").innerText();
    execFileSync(python, [...lifecycle, "restart"], {
      cwd: root,
      stdio: "inherit",
    });
    console.log("milestone9:e2e stack restarted");
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("link", { name: "Personal Finance" }),
    ).toBeVisible({
      timeout: 90_000,
    });
    await ownerPage.getByRole("link", { name: "Friends & Groups" }).click();
    await selectGroup(ownerPage, groupName);
    await expect(ownerPage.getByText("$0.00 outstanding")).toBeVisible();
    await expect(ownerPage.getByText("settled", { exact: true })).toBeVisible();
    await ownerPage
      .getByRole("link", { name: "Crypto Intelligence", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("heading", { name: "Portfolio Allocation" }),
    ).toBeVisible();

    const loggedOut = ownerPage.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith("/api/v1/auth/sessions/current"),
    );
    await ownerPage.getByRole("button", { name: "Log out" }).click();
    expect((await loggedOut).status()).toBe(204);
    await expect(ownerPage).toHaveURL("http://127.0.0.1:5173/");
    await expect(ownerPage.getByText("ResWallet is Locked!")).toBeVisible();
    await expect(
      ownerPage.getByRole("button", { name: "Connect Wallet" }),
    ).toBeDisabled();
    await expectWalletLocked(first);
    await unlockWallet(first, true);
    await expect(
      ownerPage.getByText("ResWallet Unlocked! Connect to Wallet now..."),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("button", { name: "Connect Wallet" }),
    ).toBeEnabled();
    await expect(ownerPage.locator("main")).not.toContainText(beforeRestart);
  } finally {
    await first.close();
    await second.close();
  }
});

function allocationTotal(recommendation: {
  allocations: Array<{ amount: { minor_units: number } }>;
  cash_reserve: { amount: { minor_units: number } };
}): number {
  return (
    recommendation.allocations.reduce(
      (total, allocation) => total + allocation.amount.minor_units,
      0,
    ) + recommendation.cash_reserve.amount.minor_units
  );
}

async function walletContext(label: string): Promise<BrowserContext> {
  const profile = mkdtempSync(join(tmpdir(), `resfinance-${label}-`));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const observeErrors = (page: Page) =>
    page.on("pageerror", (error) =>
      console.log(`milestone9:e2e pageerror ${page.url()} ${error.message}`),
    );
  context.pages().forEach(observeErrors);
  context.on("page", observeErrors);
  return context;
}

async function extensionId(context: BrowserContext): Promise<string> {
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker");
  return new URL(worker.url()).host;
}

async function initializeWallet(
  context: BrowserContext,
  label: string,
): Promise<{ address: string }> {
  const applicationPage = await context.newPage();
  await applicationPage.goto("http://127.0.0.1:5173/");
  await expect(
    applicationPage.getByText(/Initialize ResWallet before connecting/),
  ).toBeVisible();
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${await extensionId(context)}/popup.html`,
  );
  await page.locator("#setup-password").fill(password);
  await page.locator("#setup-password").press("Enter");
  await expect(page.locator("#unlocked")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#address")).not.toHaveText("");
  await expect(
    applicationPage.getByText("ResWallet Unlocked! Connect to Wallet now..."),
  ).toBeVisible();
  await expect(
    applicationPage.getByRole("button", { name: "Connect Wallet" }),
  ).toBeEnabled();
  const address = (await page.locator("#address").textContent())?.trim();
  if (!address) throw new Error(`${label} wallet address was not created`);
  await page.close();
  await applicationPage.close();
  return { address };
}

async function authenticate(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/finance");
  await expect(
    page.getByRole("button", { name: "Connect Wallet" }),
  ).toBeEnabled();
  await approveAfter(context, () =>
    page.getByRole("button", { name: "Connect Wallet" }).click(),
  );
  await expect(
    page.locator(".auth-card").getByRole("heading", { name: "ResFinance" }),
  ).toBeVisible();
  return page;
}

async function approveAfter(
  context: BrowserContext,
  action: () => Promise<unknown>,
) {
  await unlockWallet(context);
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker");
  const applicationPage = context
    .pages()
    .find((page) => page.url().startsWith("http://127.0.0.1:5173/"));
  if (applicationPage === undefined)
    throw new Error("ResFinance application page is unavailable");
  await expectExtensionAvailable(applicationPage);
  await action();
  let approvalUrl = "";
  await expect
    .poll(
      async () => {
        approvalUrl = await worker.evaluate(async () => {
          const contexts = await chrome.runtime.getContexts({
            contextTypes: ["POPUP"],
          });
          return (
            contexts.find((context) =>
              context.documentUrl?.includes("/approval.html?request="),
            )?.documentUrl ?? ""
          );
        });
        return approvalUrl;
      },
      { timeout: 15_000 },
    )
    .toContain("/approval.html?request=");
  const requestId = new URL(approvalUrl).searchParams.get("request");
  if (requestId === null) throw new Error("Approval request ID is unavailable");
  const browserWindowCount = await worker.evaluate(
    async () => (await chrome.windows.getAll()).length,
  );
  expect(browserWindowCount).toBe(1);
  await expect(applicationPage).toHaveURL(/127\.0\.0\.1:5173/);
  const result = await worker.evaluate(
    async (approvalRequestId) =>
      await chrome.runtime.sendMessage({
        type: "APPROVAL_DECISION",
        request_id: approvalRequestId,
        approved: true,
      }),
    requestId,
  );
  expect(result).toEqual({ ok: true, result: { approved: true } });
  await applicationPage.bringToFront();
}

async function unlockWallet(
  context: BrowserContext,
  verifyIncorrectPassword = false,
) {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${await extensionId(context)}/popup.html`,
  );
  if (await page.locator("#locked").isVisible()) {
    await expect(page.locator("#unlock-password")).toHaveAttribute(
      "placeholder",
      "Enter your password",
    );
    await expect(page.getByText("Password", { exact: true })).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unlock your Wallet" }),
    ).toBeVisible();
    if (verifyIncorrectPassword) {
      await page.locator("#unlock-password").fill("incorrect-password-value");
      await page.locator("#unlock-password").press("Enter");
      await expect(page.locator("#status-text")).toHaveText(
        "Incorrect Password",
        { timeout: 30_000 },
      );
      await expect(page.locator("#status")).toHaveAttribute(
        "data-tone",
        "error",
      );
    }
    await page.locator("#unlock-password").fill(password);
    await page.locator("#unlock-password").press("Enter");
    await expect(page.locator("#unlocked")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".identity > span")).toHaveText(
      "Your Wallet Address",
    );
    await expect(page.locator("#unlocked .hint")).toHaveText(
      "Your private key never leaves ResWallet. For your security, the wallet locks automatically after 5 minutes of inactivity.",
    );
    const lockButtonBox = await page
      .getByRole("button", { name: "Lock now" })
      .boundingBox();
    const unlockedSectionBox = await page.locator("#unlocked").boundingBox();
    expect(lockButtonBox).not.toBeNull();
    expect(unlockedSectionBox).not.toBeNull();
    expect(
      Math.abs(lockButtonBox!.width - unlockedSectionBox!.width),
    ).toBeLessThan(1);
  }
  await page.close();
}

async function expectWalletLocked(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${await extensionId(context)}/popup.html`,
  );
  await expect(page.locator("#locked")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#status-text")).toHaveText("ResWallet is Locked!");
  await expect(page.locator("#status-bulb")).toBeVisible();
  const unlockButtonBox = await page
    .getByRole("button", { name: "Unlock your Wallet" })
    .boundingBox();
  const lockedFormBox = await page.locator("#locked").boundingBox();
  expect(unlockButtonBox).not.toBeNull();
  expect(lockedFormBox).not.toBeNull();
  expect(Math.abs(unlockButtonBox!.width - lockedFormBox!.width)).toBeLessThan(
    1,
  );
  await page.close();
}

async function seedFinance(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Your money, in one view!" }),
  ).toBeVisible();
  await expect(
    page.locator("summary").filter({ hasText: /^Category$/ }),
  ).toHaveCount(0);

  const transaction = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: /^Income or expense$/ }),
  });
  await transaction.locator("summary").click();
  await transaction.getByLabel("Type").selectOption("income");
  await transaction.getByLabel("Category").selectOption({ label: "Salary" });
  await transaction.getByLabel("Amount in USD").fill("5000.00");
  await transaction.getByLabel("Description").fill("Local handoff income");
  await submitFinanceWrite(page, "/finance/transactions", () =>
    transaction.getByRole("button", { name: "Save transaction" }).click(),
  );
  await transaction.getByLabel("Type").selectOption("expense");
  await transaction.getByLabel("Category").selectOption({ label: "Rent" });
  await transaction.getByLabel("Amount in USD").fill("1000.00");
  await transaction.getByLabel("Description").fill("Local handoff rent");
  await submitFinanceWrite(page, "/finance/transactions", () =>
    transaction.getByRole("button", { name: "Save transaction" }).click(),
  );

  const budget = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: /^Monthly budget$/ }),
  });
  await budget.locator("summary").click();
  await budget.getByLabel("Expense category").selectOption({ label: "Rent" });
  await budget.getByLabel("Monthly limit in USD").fill("1200.00");
  await submitFinanceWrite(page, "/finance/budgets", () =>
    budget.getByRole("button", { name: "Save budget" }).click(),
  );
}

async function submitFinanceWrite(
  page: Page,
  endpoint: string,
  submit: () => Promise<unknown>,
) {
  const write = page.waitForResponse(
    (response) =>
      response.url().includes(endpoint) &&
      response.request().method() === "POST",
  );
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes("/finance/overview") &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await submit();
  const response = await write;
  expect(response.status(), await response.text()).toBe(201);
  await refreshed;
}

async function createAndSettleGroup(
  owner: Page,
  member: Page,
  memberAddress: string,
) {
  const groupName = `Local Handoff ${crypto.randomUUID().slice(0, 8)}`;
  await owner.getByRole("link", { name: "Friends & Groups" }).click();
  await owner.getByLabel("Group name").fill(groupName);
  await owner.getByLabel("Your display name").fill("Owner");
  const groupCreated = owner.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/groups") &&
      response.request().method() === "POST",
  );
  await owner.getByRole("button", { name: "Create group" }).click();
  expect((await groupCreated).status()).toBe(201);
  await owner.getByLabel("Wallet address").fill(memberAddress);
  await owner.getByLabel("Display name", { exact: true }).fill("Member");
  const memberCreated = owner.waitForResponse(
    (response) =>
      response.url().endsWith("/members") &&
      response.request().method() === "POST",
  );
  const groupRefreshed = owner.waitForResponse(
    (response) =>
      /\/api\/v1\/groups\/group-[^/]+$/.test(response.url()) &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await owner.getByRole("button", { name: "Add member" }).click();
  expect((await memberCreated).status()).toBe(201);
  await groupRefreshed;
  await owner.getByLabel("Description").fill("Shared dinner");
  await owner.getByLabel("Total amount").fill("60.00");
  await owner.getByLabel("Include Owner").uncheck();
  await expect(
    owner
      .locator(".split-editor li")
      .filter({ has: owner.getByLabel("Include Member") })
      .locator(".split-amount"),
  ).toHaveText("$60.00");
  await expect(
    owner.getByText("All $60.00 assigned, split equally between 1 person."),
  ).toBeVisible();
  const expenseButton = owner.getByRole("button", {
    name: "Approve split in ResWallet",
  });
  expect(
    await expenseButton
      .locator("xpath=ancestor::form")
      .evaluate((form: HTMLFormElement) => form.checkValidity()),
  ).toBe(true);
  await expectExtensionAvailable(owner);
  const expenseCreated = waitForPost(owner, /\/expenses$/);
  const expenseProjection = waitForGroupProjection(owner);
  await approveAfter(owner.context(), () => expenseButton.click());
  expect((await expenseCreated).status()).toBe(201);
  await expenseProjection;
  await expect(owner.getByText("$60.00 outstanding")).toBeVisible();

  await member.reload();
  await expect(
    member.locator(".auth-card").getByRole("heading", { name: "ResFinance" }),
  ).toBeVisible();
  await member.getByRole("link", { name: "Friends & Groups" }).click();
  await selectGroup(member, groupName);
  const decisionCreated = waitForPost(member, /\/decision$/);
  const decisionProjection = waitForGroupProjection(member);
  await approveAfter(member.context(), () =>
    member.getByRole("button", { name: "Approve in ResWallet" }).click(),
  );
  expect((await decisionCreated).status()).toBe(201);
  await decisionProjection;
  await member.locator("details.group-update > summary").click();
  await member.getByLabel("Credit amount (USD units)").fill("60.00");
  const fundingRequestPromise = member.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/credits"),
  );
  const fundingCreated = waitForPost(member, /\/credits$/);
  const fundingProjection = waitForGroupProjection(member);
  await approveAfter(member.context(), () =>
    member
      .getByRole("button", { name: "Approve funding in ResWallet" })
      .click(),
  );
  const fundingRequest = await fundingRequestPromise;
  expect((await fundingCreated).status()).toBe(201);
  await fundingProjection;
  await proveTamperAndReplayRejection(member, fundingRequest);
  await member.getByLabel("Partial or full amount").fill("20.00");
  const partialSettlement = waitForPost(member, /\/settlements$/);
  const partialProjection = waitForGroupProjection(member);
  await approveAfter(member.context(), () =>
    member.getByRole("button", { name: "Settle with credits" }).click(),
  );
  expect((await partialSettlement).status()).toBe(201);
  await partialProjection;
  await expect(member.getByText("$40.00 outstanding")).toBeVisible();
  await member.getByLabel("Partial or full amount").fill("40.00");
  const finalSettlement = waitForPost(member, /\/settlements$/);
  const finalProjection = waitForGroupProjection(member);
  await approveAfter(member.context(), () =>
    member.getByRole("button", { name: "Settle with credits" }).click(),
  );
  expect((await finalSettlement).status()).toBe(201);
  await finalProjection;
  await expect(member.getByText("$0.00 outstanding")).toBeVisible();
  return groupName;
}

async function selectGroup(page: Page, groupName: string) {
  await page
    .getByRole("navigation", { name: "Your groups" })
    .getByRole("button")
    .filter({ hasText: groupName })
    .click();
}

function waitForPost(page: Page, endpoint: RegExp, timeout = 30_000) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && endpoint.test(response.url()),
    { timeout },
  );
}

function waitForGet(page: Page, endpoint: RegExp, timeout = 30_000) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      endpoint.test(response.url()) &&
      response.status() === 200,
    { timeout },
  );
}

function waitForGroupProjection(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/api\/v1\/groups\/group-[^/]+$/.test(response.url()) &&
      response.status() === 200,
    { timeout: 120_000 },
  );
}

async function proveTamperAndReplayRejection(page: Page, request: Request) {
  const url = request.url();
  const headers = await request.allHeaders();
  const original = JSON.parse(request.postData() ?? "{}") as {
    amount: { minor_units: number };
  };
  const authorization = headers.authorization;
  if (!authorization)
    throw new Error("funding request omitted its access token");
  const tampered = structuredClone(original);
  tampered.amount.minor_units += 1;
  const statuses = await page.evaluate(
    async ({ endpoint, accessToken, body, replayBody }) => {
      const send = (value: object, idempotency: string) =>
        fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            Authorization: accessToken,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency,
          },
          body: JSON.stringify(value),
        });
      const tamper = await send(body, `tamper-${crypto.randomUUID()}`);
      const replay = await send(replayBody, `replay-${crypto.randomUUID()}`);
      return [tamper.status, replay.status];
    },
    {
      endpoint: url,
      accessToken: authorization,
      body: tampered,
      replayBody: original,
    },
  );
  expect(statuses).toEqual([422, 422]);
}

async function proveWrongOriginHasNoExtension(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8000/api/v1/health");
  const answered = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const requestId = crypto.randomUUID();
        const timer = window.setTimeout(() => resolve(false), 750);
        window.addEventListener("message", (event) => {
          const value = event.data as { source?: string; request_id?: string };
          if (value.source === "reswallet" && value.request_id === requestId) {
            window.clearTimeout(timer);
            resolve(true);
          }
        });
        window.postMessage(
          {
            source: "resfinance-page",
            version: 1,
            request_id: requestId,
            type: "GET_IDENTITY",
          },
          window.location.origin,
        );
      }),
  );
  expect(answered).toBe(false);
  await page.close();
}

async function expectExtensionAvailable(page: Page) {
  const response = await page.evaluate(
    () =>
      new Promise<{ ok?: boolean; error?: string }>((resolve) => {
        const requestId = crypto.randomUUID();
        const timer = window.setTimeout(
          () => resolve({ error: "extension response timed out" }),
          2_000,
        );
        window.addEventListener("message", (event) => {
          const value = event.data as {
            source?: string;
            request_id?: string;
            ok?: boolean;
            error?: string;
          };
          if (value.source === "reswallet" && value.request_id === requestId) {
            window.clearTimeout(timer);
            resolve(value);
          }
        });
        window.postMessage(
          {
            source: "resfinance-page",
            version: 1,
            request_id: requestId,
            type: "GET_IDENTITY",
          },
          window.location.origin,
        );
      }),
  );
  expect(response, response.error).toMatchObject({ ok: true });
}
