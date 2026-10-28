import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

import { approveWalletLogin, prepareWalletLogin } from "./wallet-login";

const debtor = `0x${"b".repeat(40)}`;
const creditor = `0x${"a".repeat(40)}`;
const obligationId = "obl-dinner-sam";

test("approves and settles an obligation partially and fully", async ({
  page,
}) => {
  await prepareWalletLogin(page, debtor);
  let projectionVersion = 1;
  let status = "pending";
  let settled = 0;
  let debtorCredits = 0;
  let creditorCredits = 0;

  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const message = event.data as {
        source?: string;
        type?: string;
        request_id?: string;
        intent?: Record<string, unknown>;
      };
      if (
        message.source !== "resfinance-page" ||
        message.type !== "SIGN_INTENT" ||
        message.intent?.action === "auth.login"
      )
        return;
      const intent = message.intent!;
      window.postMessage(
        {
          source: "reswallet",
          version: 1,
          request_id: message.request_id,
          ok: true,
          result: {
            version: 1,
            intent_id: intent.intent_id,
            action: intent.action,
            actor_public_key: "e2e-public-key",
            actor_address: `0x${"b".repeat(40)}`,
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
  });

  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "groups-e2e-token",
        token_type: "Bearer",
        expires_at: "2026-10-14T18:00:00Z",
        actor_address: debtor,
      }),
    }),
  );
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "resfinance-api" }),
    }),
  );
  await page.route("**/api/v1/groups", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          group_id: "friends",
          name: "Friends",
          member_count: 2,
          open_obligation_count: status === "settled" ? 0 : 1,
          projection_version: projectionVersion,
        },
      ]),
    });
  });
  await page.route("**/api/v1/groups/friends", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(groupOverview()),
    });
  });
  await page.route("**/api/v1/groups/friends/credits", async (route) => {
    const body = route.request().postDataJSON() as {
      amount: { minor_units: number };
    };
    debtorCredits += body.amount.minor_units;
    projectionVersion += 1;
    await commandResponse(route, "credits");
  });
  await page.route(
    `**/api/v1/groups/friends/obligations/${obligationId}/decision`,
    async (route) => {
      status = "open";
      projectionVersion += 1;
      await commandResponse(route, "approve");
    },
  );
  await page.route(
    `**/api/v1/groups/friends/obligations/${obligationId}/settlements`,
    async (route) => {
      const body = route.request().postDataJSON() as {
        amount: { minor_units: number };
      };
      settled += body.amount.minor_units;
      debtorCredits -= body.amount.minor_units;
      creditorCredits += body.amount.minor_units;
      status = settled === 6000 ? "settled" : "partially_settled";
      projectionVersion += 1;
      await commandResponse(route, "settlement");
    },
  );

  await page.goto("/groups");
  await approveWalletLogin(page);
  const groupsTitle = page.locator("#groups-title");
  await expect(groupsTitle).toBeVisible();
  const heroDescription = page.locator(
    ".groups-dashboard .dashboard-hero-copy > .lede",
  );
  await expect(heroDescription).toBeVisible();
  await expect(heroDescription).toHaveCSS("white-space", "normal");

  const groupNetwork = page.locator(".group-network");
  await expect(groupNetwork).toBeVisible();
  await expect(
    groupNetwork.getByRole("heading", { name: "Your Groups Network!" }),
  ).toBeVisible();
  await expect(
    groupNetwork.getByRole("button", { name: "New Group" }),
  ).toBeVisible();
  await expect(groupNetwork.locator(".network-metric")).toHaveCount(2);
  await expect(groupNetwork.getByText("1 group · 1 connection")).toBeVisible();
  await expect(
    groupNetwork.locator(".network-metric-credits strong"),
  ).toHaveText("$0.00");
  await expect(
    groupNetwork.locator(".network-metric-owe .network-metric-primary strong"),
  ).toHaveText("$0.00");
  await expect(groupNetwork.locator(".network-metric-owed strong")).toHaveText(
    "$0.00",
  );
  await expect(groupNetwork.locator(".net-balance-row")).toHaveCount(0);
  await expect(
    groupNetwork.getByText(
      "No outstanding balances yet. Approved obligations appear here.",
    ),
  ).toBeVisible();
  await expect(groupNetwork.getByText("You owe", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "test-results/groups-network-overview.png",
    fullPage: false,
  });

  const standardViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 2366, height: 900 });
  await expect(heroDescription).toHaveCSS("white-space", "normal");
  expect(
    await heroDescription.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(groupsTitle).toHaveCSS("white-space", "nowrap");
  expect(
    await groupsTitle.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThan(70);
  await page.screenshot({
    path: "test-results/groups-dashboard-header-wide.png",
    fullPage: false,
  });
  await page.setViewportSize(standardViewport);
  await expect(heroDescription).toHaveCSS("white-space", "normal");
  await expect(groupsTitle).toHaveCSS("white-space", "normal");

  const guideButton = page.getByRole("button", {
    name: "How to use the Friends & Groups dashboard",
  });
  await expect(guideButton).toHaveCSS("color", "rgb(242, 189, 90)");
  await guideButton.click();
  const dashboardGuide = page.getByRole("dialog", {
    name: "How to use this dashboard?",
  });
  await expect(dashboardGuide).toBeVisible();
  await expect(
    dashboardGuide.getByText("Split an expense", { exact: true }),
  ).toBeVisible();
  await expect(
    dashboardGuide.getByText("Approve and settle", { exact: true }),
  ).toBeVisible();
  await expect(
    dashboardGuide.getByText("Know the boundary", { exact: true }),
  ).toBeVisible();
  await expect(dashboardGuide.locator("li")).toHaveCount(4);
  await expect(
    dashboardGuide.getByText(
      "This dashboard does not transfer fiat or cryptocurrency.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/groups-dashboard-guide.png",
    fullPage: false,
  });
  await dashboardGuide
    .getByRole("button", { name: "Close dashboard guide" })
    .click();
  await expect(dashboardGuide).not.toBeVisible();

  const walletChip = page.locator(".wallet-chip");
  await expect(walletChip).toHaveCSS("background-color", "rgb(24, 43, 52)");
  await expect(walletChip).toHaveCSS("border-color", "rgb(50, 99, 106)");
  await expect(walletChip).toHaveCSS("color", "rgb(189, 231, 228)");
  await expect(walletChip.locator(".wallet-chip-icon")).toHaveCSS(
    "color",
    "rgb(54, 207, 195)",
  );

  await expect(page.getByRole("tab", { name: /^Obligations/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("$60.00 outstanding")).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const membersButton = page.getByRole("button", { name: /^2 members/ });
  const membersPopover = page.getByRole("dialog", { name: "Group members" });
  await expect(membersButton).toHaveAttribute("aria-expanded", "false");
  await expect(membersPopover).toHaveCount(0);

  await membersButton.click();
  await expect(membersPopover).toBeVisible();
  await expect(membersButton).toHaveAttribute("aria-expanded", "true");
  const alexRow = membersPopover
    .getByRole("listitem")
    .filter({ hasText: "Alex" });
  const samRow = membersPopover
    .getByRole("listitem")
    .filter({ hasText: "Sam" });
  await expect(alexRow.getByText("Owner", { exact: true })).toBeVisible();
  await expect(samRow.getByText("You", { exact: true })).toBeVisible();
  expect(
    await alexRow
      .locator(".member-display-name")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeLessThan(16);
  await expect(alexRow.locator("code")).toHaveText("0xaaaaaa…aaaaaa");
  await expect(alexRow.locator("code")).toHaveAttribute("title", creditor);

  await alexRow
    .getByRole("button", { name: "Copy Alex's wallet address" })
    .click();
  await expect(alexRow.getByRole("button", { name: /Copy Alex/ })).toHaveText(
    "Copied",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    creditor,
  );

  await expectInsideViewport(page, membersPopover);
  await page.screenshot({ path: "test-results/groups-members-popover.png" });

  await page.keyboard.press("Escape");
  await expect(membersPopover).toHaveCount(0);
  await expect(membersButton).toBeFocused();

  const desktopViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(heroDescription).toHaveCSS("white-space", "normal");
  await expect(groupsTitle).toHaveCSS("white-space", "normal");
  await membersButton.click();
  await expectInsideViewport(page, membersPopover);
  await page.screenshot({
    path: "test-results/groups-members-popover-mobile.png",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize(desktopViewport);

  await membersButton.click();
  await expect(membersPopover).toBeVisible();
  await groupsTitle.click();
  await expect(membersPopover).toHaveCount(0);

  await expect(page.locator(".obligation-parties")).toHaveText(
    words("You owe Alex"),
    { useInnerText: true },
  );
  await page.getByRole("button", { name: "Approve in ResWallet" }).click();
  await expect(page.getByText("open", { exact: true })).toBeVisible();
  await expect(page.locator(".settle-hint")).toHaveText(
    "You have $0.00 in credits. Fund $60.00 more under Fund internal credits to settle this in full.",
  );

  await expect(summaryValue(page, "You owe")).toHaveText("$60.00");
  const netBalance = groupNetwork.locator(".net-balance-row.owe");
  await expect(netBalance).toHaveText("Alex-$60.00");
  await expect(netBalance.locator(".net-balance-amount")).toHaveCSS(
    "color",
    "rgb(255, 140, 160)",
  );
  await page.screenshot({
    path: "test-results/groups-network-effective-balance.png",
    fullPage: false,
  });
  await page.getByLabel("Credit amount (USD units)").fill("60.00");
  await page
    .getByRole("button", { name: "Approve funding in ResWallet" })
    .click();
  await expect(summaryValue(page, "Your credits")).toHaveText("$60.00");
  await expect(page.locator(".settle-hint")).toHaveCount(0);

  await page.getByLabel("Partial or full amount").fill("20.00");
  await page.getByRole("button", { name: "Settle with credits" }).click();
  await expect(page.getByText("$40.00 outstanding")).toBeVisible();
  await expect(
    page.getByText("partially settled", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Partial or full amount").fill("40.00");
  await page.getByRole("button", { name: "Settle with credits" }).click();
  await expect(page.getByText("$0.00 outstanding")).toBeVisible();
  await expect(page.getByText("settled", { exact: true })).toBeVisible();
  await expect(summaryValue(page, "You owe")).toHaveText("$0.00");
  await expect(page.getByText(/non-redeemable, non-monetary/)).toBeVisible();
  await expect(page.getByText("Data Freshness and Provenance")).toBeVisible();
  await expect(
    page
      .locator(".group-summary-grid")
      .getByText("Projection", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Projection v5/)).toBeVisible();
  await expect(page.getByText(/5 encrypted source events/)).toBeVisible();
  await page.screenshot({
    path: "test-results/groups-dashboard.png",
    fullPage: true,
  });

  function groupOverview() {
    return {
      group_id: "friends",
      name: "Friends",
      owner_address: creditor,
      members: [
        {
          actor_address: creditor,
          display_name: "Alex",
          active: true,
          source_event_id: "evt-group",
        },
        {
          actor_address: debtor,
          display_name: "Sam",
          active: true,
          source_event_id: "evt-member",
        },
      ],
      expenses: [],
      obligations: [
        {
          obligation_id: obligationId,
          expense_id: "dinner",
          creditor_address: creditor,
          debtor_address: debtor,
          amount: { currency: "USD", minor_units: 6000 },
          settled_amount: { currency: "USD", minor_units: settled },
          outstanding_amount: { currency: "USD", minor_units: 6000 - settled },
          due_on: "2026-10-31",
          status,
          source_event_id: `evt-${projectionVersion}`,
          contract_receipts: ["receipt-create"],
        },
      ],
      credit_balances: {
        [debtor]: { currency: "USD", minor_units: debtorCredits },
        [creditor]: { currency: "USD", minor_units: creditorCredits },
      },
      notifications: [],
      provenance: {
        projection_version: projectionVersion,
        as_of_utc: "2026-10-14T17:00:00Z",
        source_event_ids: Array.from(
          { length: projectionVersion },
          (_, index) => `evt-${index + 1}`,
        ),
      },
      credit_disclaimer:
        "Internal credits are non-redeemable, non-monetary, and have no cash value.",
    };
  }
});

test("explains what to do when the user has no groups", async ({ page }) => {
  await mockSession(page, creditor);
  await page.route("**/api/v1/groups", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );

  await page.goto("/groups");
  await approveWalletLogin(page);
  await expect(
    page.getByText(/No groups yet\. Create one above/),
  ).toBeVisible();
  await expect(page.locator(".members-menu")).toHaveCount(0);
});

test("shows validation and signing failures inside the affected form", async ({
  page,
}) => {
  let commandRequests = 0;
  await mockSession(page, creditor);
  await mockVault(page, {
    ok: false,
    error: "User rejected the request in ResWallet",
  });
  await mockGroup(page, [
    { address: creditor, name: "Alex" },
    { address: debtor, name: "Sam" },
  ]);
  await page.route("**/api/v1/groups/friends/**", async (route) => {
    commandRequests += 1;
    await route.abort();
  });

  await page.goto("/groups");
  await approveWalletLogin(page);
  const expenseForm = page.locator(".expense-form");
  await expect(
    expenseForm.getByRole("heading", { name: "Add an expense" }),
  ).toBeVisible();

  await expenseForm.getByLabel("Description").fill("Dinner");
  await expenseForm.getByLabel("Total amount").fill("60.00");
  await expenseForm.getByLabel("Exact amounts").check();
  await expenseForm.getByLabel("Alex's share").fill("0.00");
  await expenseForm.getByLabel("Sam's share").fill("60.00");
  await expenseForm
    .getByRole("button", { name: "Approve split in ResWallet" })
    .click();
  await expect(expenseForm.getByRole("alert")).toHaveText(
    "Alex's share: Amount must be greater than $0.00.",
  );

  await expenseForm.getByLabel("Include Alex").uncheck();
  await expect(expenseForm.getByText("All $60.00 assigned.")).toBeVisible();
  await expenseForm
    .getByRole("button", { name: "Approve split in ResWallet" })
    .click();
  await expect(expenseForm.getByRole("alert")).toHaveText(
    "User rejected the request in ResWallet",
  );

  const creditForm = page.locator(".credits-form");
  await creditForm.getByLabel("Credit amount (USD units)").fill("0");
  await creditForm
    .getByRole("button", { name: "Approve funding in ResWallet" })
    .click();
  await expect(creditForm.getByRole("alert")).toHaveText(
    "Amount must be greater than $0.00.",
  );
  await expect(expenseForm.getByRole("alert")).toHaveText(
    "User rejected the request in ResWallet",
  );
  expect(commandRequests).toBe(0);
});

test("splits an expense equally between the selected members by default", async ({
  page,
}) => {
  const posted = await mockSplitGroup(page);
  await page.goto("/groups");
  await approveWalletLogin(page);
  const expenseForm = page.locator(".expense-form");
  await expect(expenseForm.getByText("Paid by you (Alex).")).toBeVisible();
  await expect(expenseForm.getByLabel("Split equally")).toBeChecked();
  await expect(expenseForm.getByLabel("Include Alex")).toBeChecked();
  await expect(expenseForm.getByLabel("Include Sam")).toBeChecked();
  await expect(expenseForm.getByLabel("Include Priya")).toBeChecked();
  await expect(
    expenseForm.getByText("Enter the total to split it equally."),
  ).toBeVisible();

  await expenseForm.getByLabel("Description").fill("Dinner");
  await expenseForm.getByLabel("Total amount").fill("90.00");
  for (const name of ["Alex", "Sam", "Priya"])
    await expect(equalShare(expenseForm, name)).toHaveText("$30.00");
  await expect(
    expenseForm.getByText(
      "All $90.00 assigned, split equally between 3 people.",
    ),
  ).toBeVisible();

  await expenseForm.getByLabel("Include Priya").uncheck();
  await expect(equalShare(expenseForm, "Alex")).toHaveText("$45.00");
  await expect(equalShare(expenseForm, "Sam")).toHaveText("$45.00");
  await expect(equalShare(expenseForm, "Priya")).toHaveText("Not included");

  await expenseForm.getByLabel("Total amount").fill("10.01");
  await expect(equalShare(expenseForm, "Alex")).toHaveText("$5.01");
  await expect(equalShare(expenseForm, "Sam")).toHaveText("$5.00");
  await expect(
    expenseForm.getByText(
      "All $10.01 assigned, split equally between 2 people.",
    ),
  ).toBeVisible();

  const samName = expenseForm
    .locator(".split-member")
    .filter({ hasText: "Sam" });
  await samName.locator(".member-name").hover();
  await expect(samName.getByRole("tooltip")).toBeVisible();
  await expect(samName.getByRole("tooltip")).toHaveText(debtor);
  await expenseForm.screenshot({
    path: "test-results/groups-expense-split-equal.png",
  });

  await expenseForm
    .getByRole("button", { name: "Approve split in ResWallet" })
    .click();
  await expect.poll(() => posted.length).toBe(1);
  const body = posted[0]!;
  expect(body.payer_address).toBe(creditor);
  expect(body.description).toBe("Dinner");
  expect(body.amount).toEqual({ currency: "USD", minor_units: 1001 });
  expect(body.shares).toEqual({
    [creditor]: { currency: "USD", minor_units: 501 },
    [debtor]: { currency: "USD", minor_units: 500 },
  });
  expect(body.intent.action).toBe("split.approve");
  expect(body.intent.resource_id).toBe(body.expense_id);

  await expect(expenseForm.getByLabel("Description")).toHaveValue("");
  await expect(expenseForm.getByLabel("Include Priya")).toBeChecked();
  await expect(expenseForm.getByLabel("Split equally")).toBeChecked();
  await expect(expenseForm.getByRole("alert")).toHaveCount(0);
});

test("lets the payer adjust an equal split into exact amounts", async ({
  page,
}) => {
  const posted = await mockSplitGroup(page);
  await page.goto("/groups");
  await approveWalletLogin(page);
  const expenseForm = page.locator(".expense-form");
  await expenseForm.getByLabel("Description").fill("Groceries");
  await expenseForm.getByLabel("Total amount").fill("90.00");

  await expenseForm.getByLabel("Exact amounts").check();
  for (const name of ["Alex", "Sam", "Priya"])
    await expect(expenseForm.getByLabel(`${name}'s share`)).toHaveValue(
      "30.00",
    );
  await expect(expenseForm.getByText("All $90.00 assigned.")).toBeVisible();

  await expenseForm.getByLabel("Include Priya").uncheck();
  await expect(expenseForm.getByLabel("Priya's share")).toBeDisabled();
  await expect(expenseForm.getByLabel("Priya's share")).toHaveValue("");
  await expect(
    expenseForm.getByText("$60.00 of $90.00 assigned · $30.00 left"),
  ).toBeVisible();

  await expenseForm.getByLabel("Sam's share").fill("70.00");
  await expect(
    expenseForm.getByText("$100.00 of $90.00 assigned · $10.00 over"),
  ).toBeVisible();
  await expenseForm.getByLabel("Sam's share").fill("60.00");
  await expect(expenseForm.getByText("All $90.00 assigned.")).toBeVisible();
  await expenseForm.screenshot({
    path: "test-results/groups-expense-split-exact.png",
  });

  await expenseForm
    .getByRole("button", { name: "Approve split in ResWallet" })
    .click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]!.amount).toEqual({ currency: "USD", minor_units: 9000 });
  expect(posted[0]!.shares).toEqual({
    [creditor]: { currency: "USD", minor_units: 3000 },
    [debtor]: { currency: "USD", minor_units: 6000 },
  });

  await expect(expenseForm.getByLabel("Split equally")).toBeChecked();
  await expect(expenseForm.getByLabel("Include Priya")).toBeChecked();
});

test("shows that it is waiting for ResWallet and then saving", async ({
  page,
}) => {
  let releaseSave = () => {};
  const saveReleased = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveRequests = 0;
  await mockSession(page, creditor);
  await mockVault(page, { ok: true, actorAddress: creditor, manual: true });
  await mockGroup(page, [
    { address: creditor, name: "Alex" },
    { address: debtor, name: "Sam" },
  ]);
  await page.route("**/api/v1/groups/friends/expenses", async (route) => {
    saveRequests += 1;
    await saveReleased;
    await commandResponse(route, "expense");
  });

  await page.goto("/groups");
  await approveWalletLogin(page);
  const expenseForm = page.locator(".expense-form");
  const submit = expenseForm.getByRole("button", {
    name: "Approve split in ResWallet",
  });
  await expenseForm.getByLabel("Description").fill("Taxi");
  await expenseForm.getByLabel("Total amount").fill("40.00");
  await submit.click();

  const status = expenseForm.getByRole("status");
  await expect(status).toContainText("Waiting for your approval in ResWallet");
  await expect(status).toContainText("check behind this browser window");
  await expect(submit).toBeDisabled();
  await page.screenshot({ path: "test-results/groups-waiting-reswallet.png" });
  expect(saveRequests).toBe(0);

  await page.evaluate(() =>
    (window as unknown as { approveVault(): void }).approveVault(),
  );
  await expect(status).toHaveText("Saving to the group…");
  await expect(submit).toBeDisabled();
  await expect.poll(() => saveRequests).toBe(1);

  releaseSave();
  await expect(status).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await expect(expenseForm.getByRole("alert")).toHaveCount(0);
  await expect(expenseForm.getByLabel("Description")).toHaveValue("");
});

test("lists expenses and obligations by name", async ({ page }) => {
  const priya = `0x${"c".repeat(40)}`;
  const usd = (minor_units: number) => ({ currency: "USD", minor_units });
  const obligation = (
    id: string,
    expenseId: string,
    creditor: string,
    debtor: string,
    amount: number,
    settled: number,
    status: string,
  ) => ({
    obligation_id: id,
    expense_id: expenseId,
    creditor_address: creditor,
    debtor_address: debtor,
    amount: usd(amount),
    settled_amount: usd(settled),
    outstanding_amount: usd(amount - settled),
    due_on: null,
    status,
    source_event_id: `evt-${id}`,
    contract_receipts: [`receipt-${id}`],
  });
  await mockSession(page, creditor);
  await mockGroup(
    page,
    [
      { address: creditor, name: "Alex" },
      { address: debtor, name: "Sam" },
      { address: priya, name: "Priya" },
    ],
    {
      expenses: [
        {
          expense_id: "dinner",
          payer_address: creditor,
          description: "Dinner",
          amount: usd(9000),
          occurred_on: "2026-10-18",
          shares: {
            [creditor]: usd(3000),
            [debtor]: usd(3000),
            [priya]: usd(3000),
          },
          obligation_ids: ["obl-dinner-sam", "obl-dinner-priya"],
          source_event_id: "evt-dinner",
          contract_receipts: ["receipt-dinner"],
        },
        {
          expense_id: "taxi",
          payer_address: debtor,
          description: "Taxi",
          amount: usd(4000),
          occurred_on: "2026-10-19",
          shares: { [debtor]: usd(2000), [creditor]: usd(2000) },
          obligation_ids: ["obl-taxi-alex"],
          source_event_id: "evt-taxi",
          contract_receipts: ["receipt-taxi"],
        },
      ],
      obligations: [
        obligation(
          "obl-dinner-sam",
          "dinner",
          creditor,
          debtor,
          3000,
          0,
          "pending",
        ),
        obligation(
          "obl-dinner-priya",
          "dinner",
          creditor,
          priya,
          3000,
          1000,
          "partially_settled",
        ),
        obligation("obl-taxi-alex", "taxi", debtor, creditor, 2000, 0, "open"),
      ],
      credit_balances: { [creditor]: usd(500) },
    },
  );

  await page.goto("/groups");
  await approveWalletLogin(page);
  const obligationsTab = page.getByRole("tab", { name: /^Obligations/ });
  const expensesTab = page.getByRole("tab", { name: /^Expenses/ });
  await expect(obligationsTab).toHaveAttribute("aria-selected", "true");
  await expect(obligationsTab.locator(".tab-count")).toHaveText("3");
  await expect(obligationsTab.locator(".tab-badge")).toHaveText("1 TODO");
  await expect(page.locator("details.group-update")).not.toHaveAttribute(
    "open",
  );
  await expect(summaryValue(page, "You owe")).toHaveText("$20.00");
  await expect(summaryValue(page, "You are owed")).toHaveText("$20.00");
  const balances = page.locator(".group-network");
  await expect(
    balances.getByRole("heading", { name: "Net Balances" }),
  ).toBeVisible();
  await expect(balances.locator(".net-balance-row.owed")).toHaveText(
    "Priya+$20.00",
  );
  await expect(balances.locator(".net-balance-row.owe")).toHaveText(
    "Sam-$20.00",
  );
  await expect(balances.locator(".network-metric-credits strong")).toHaveText(
    "$5.00",
  );
  await expect(
    balances.locator(".network-metric-owe .network-metric-primary strong"),
  ).toHaveText("$20.00");
  await expect(balances.locator(".network-metric-owed strong")).toHaveText(
    "$20.00",
  );
  await balances.screenshot({
    path: "test-results/groups-balance.png",
  });
  await expensesTab.click();
  const expenses = page.locator(".expenses-panel");
  await expect(expensesTab.locator(".tab-count")).toHaveText("2");
  await expect(expenses.getByText("Showing 2 of 2")).toBeVisible();
  const cards = expenses.locator(".expense-card");
  await expect(cards).toHaveCount(2);

  const taxi = cards.nth(0);
  await expect(taxi.getByRole("heading", { name: "Taxi" })).toBeVisible();
  await expect(taxi.locator(".expense-heading p")).toHaveText(
    words("Oct 19, 2026 · Paid by Sam"),
    { useInnerText: true },
  );
  await expect(taxi.locator(".expense-total")).toHaveText("$40.00");
  const taxiShares = taxi.getByRole("list", { name: "Split for Taxi" });
  await expect(taxiShares.getByRole("listitem")).toHaveText(
    [words("Sam $20.00 Own share"), words("You $20.00")],
    { useInnerText: true },
  );

  const dinner = cards.nth(1);
  await expect(dinner.locator(".expense-heading p")).toHaveText(
    words("Oct 18, 2026 · Paid by you"),
    { useInnerText: true },
  );
  await expect(
    dinner
      .getByRole("list", { name: "Split for Dinner" })
      .getByRole("listitem"),
  ).toHaveText(
    [words("You $30.00 Own share"), words("Sam $30.00"), words("Priya $30.00")],
    { useInnerText: true },
  );
  const dinnerSam = dinner
    .getByRole("listitem")
    .filter({ hasText: "Sam" })
    .locator(".member-name");
  await dinnerSam.hover();
  await expect(dinnerSam.getByRole("tooltip")).toBeVisible();
  await expect(dinnerSam.getByRole("tooltip")).toHaveText(debtor);
  await page.mouse.move(0, 0);
  await expenses.screenshot({ path: "test-results/groups-expenses.png" });

  await obligationsTab.click();
  const obligations = page.locator(".obligation-card");
  await expect(obligations.locator(".obligation-parties")).toHaveText(
    [
      words("Sam owes you for Dinner"),
      words("Priya owes you for Dinner"),
      words("You owe Sam for Taxi"),
    ],
    { useInnerText: true },
  );
  await expect(obligations.nth(1)).toContainText(
    "Original $30.00 · $10.00 settled",
  );
  await expect(obligations.nth(0)).not.toContainText("settled ·");

  const taxiDebt = obligations.nth(2);
  await expect(
    taxiDebt.getByRole("button", { name: "Settle with credits" }),
  ).toBeVisible();
  await expect(taxiDebt.locator(".settle-hint")).toHaveText(
    "You have $5.00 in credits. Fund $15.00 more under Fund internal credits to settle this in full.",
  );
  await expect(obligations.nth(0).locator(".settle-hint")).toHaveCount(0);
  await page.locator(".obligations-panel").screenshot({
    path: "test-results/groups-obligations.png",
  });

  const filters = page.getByRole("group", { name: "Filter obligations" });
  await expect(filters.locator(".chip-count")).toHaveText(["3", "1", "3", "0"]);
  await expect(filters.getByRole("button", { name: /^All/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await filters.getByRole("button", { name: /^Needs your action/ }).click();
  await expect(obligations.locator(".obligation-parties")).toHaveText(
    [words("You owe Sam for Taxi")],
    { useInnerText: true },
  );
  await filters.getByRole("button", { name: /^Settled/ }).click();
  await expect(
    page.getByText("No obligations match this filter."),
  ).toBeVisible();

  await page.getByRole("tab", { name: /^Notifications/ }).click();
  await expect(page.getByText("No new group notifications.")).toBeVisible();
});

test("pages long expense histories and keeps focus visible", async ({
  page,
}) => {
  const usd = (minor_units: number) => ({ currency: "USD", minor_units });
  const expenses = Array.from({ length: 14 }, (_, index) => ({
    expense_id: `expense-${index}`,
    payer_address: index % 2 === 0 ? creditor : debtor,
    description: `Expense ${index + 1}`,
    amount: usd(1000 + index),
    occurred_on: `2026-10-${String(index + 1).padStart(2, "0")}`,
    shares:
      index === 13
        ? Object.fromEntries(
            Array.from({ length: 12 }, (_, person) => [
              person === 0
                ? creditor
                : `0x${person.toString(16).padStart(40, "c")}`,
              usd(125),
            ]),
          )
        : { [creditor]: usd(500), [debtor]: usd(500 + index) },
    obligation_ids: [],
    source_event_id: `evt-expense-${index}`,
    contract_receipts: [`receipt-expense-${index}`],
  }));
  await mockSession(page, creditor);
  await mockGroup(
    page,
    [
      { address: creditor, name: "Alex" },
      { address: debtor, name: "Sam" },
    ],
    { expenses },
  );

  await page.goto("/groups");
  await approveWalletLogin(page);
  const expensesTab = page.getByRole("tab", { name: /^Expenses/ });
  await expect(expensesTab).toHaveAttribute("aria-selected", "true");
  const panel = page.locator(".expenses-panel");
  const cards = panel.locator(".expense-card");
  await expect(cards).toHaveCount(6);
  await expect(cards.first().getByRole("heading")).toHaveText("Expense 14");
  await expect(panel.getByText("Showing 6 of 14")).toBeVisible();
  const crowded = cards.nth(0);
  const ordinary = cards.nth(1);
  await expect(crowded.getByRole("button", { name: "4 more" })).toBeVisible();
  await expect(
    crowded
      .getByRole("list", { name: "Split for Expense 14" })
      .getByRole("listitem"),
  ).toHaveCount(8);
  const ordinaryHeight = (await ordinary.boundingBox())!.height;
  expect(
    Math.abs((await crowded.boundingBox())!.height - ordinaryHeight),
  ).toBeLessThan(2);
  await crowded.getByRole("button", { name: "4 more" }).click();
  const others = page.getByRole("dialog", {
    name: "Other people in Expense 14",
  });
  await expect(others.getByRole("listitem")).toHaveCount(4);
  expect(
    Math.abs((await crowded.boundingBox())!.height - ordinaryHeight),
  ).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(others).toHaveCount(0);

  await panel.getByRole("button", { name: "Show 6 more" }).click();
  await expect(cards).toHaveCount(12);
  await panel.getByRole("button", { name: "Show 2 more" }).click();
  await expect(cards).toHaveCount(14);
  await expect(
    panel.getByRole("button", { name: /^Show \d+ more$/ }),
  ).toHaveCount(0);

  await panel.getByRole("button", { name: /^Paid by you/ }).click();
  await expect(cards).toHaveCount(6);
  await expect(panel.getByText("Showing 6 of 7")).toBeVisible();

  await expensesTab.focus();
  await page.keyboard.press("ArrowLeft");
  const obligationsTab = page.getByRole("tab", { name: /^Obligations/ });
  await expect(obligationsTab).toBeFocused();
  await expect(obligationsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("No obligations yet.")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /^Notifications/ })).toBeFocused();

  const update = page.locator("details.group-update > summary");
  await update.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details.group-update")).toHaveAttribute(
    "open",
    "",
  );
  for (const name of [
    "Add member",
    "Approve funding in ResWallet",
    "Approve split in ResWallet",
    "New group",
  ]) {
    const button = page.getByRole("button", { name });
    await button.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    expect(await focusOutline(button)).not.toBe("none");
  }
  await page.screenshot({
    path: "test-results/groups-paged-light.png",
    fullPage: true,
  });

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: "test-results/groups-paged-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectInsideViewport(page, page.locator(".activity-tabs"));
  await page.screenshot({
    path: "test-results/groups-paged-mobile-dark.png",
    fullPage: true,
  });
});

function summaryValue(page: Page, label: string): Locator {
  return page
    .locator(".group-summary-grid .metric-card")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("strong");
}

function focusOutline(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).outlineStyle);
}

async function mockSplitGroup(page: Page): Promise<ExpenseRequest[]> {
  const posted: ExpenseRequest[] = [];
  await mockSession(page, creditor);
  await mockVault(page, { ok: true, actorAddress: creditor });
  await mockGroup(page, [
    { address: creditor, name: "Alex" },
    { address: debtor, name: "Sam" },
    { address: `0x${"c".repeat(40)}`, name: "Priya" },
  ]);
  await page.route("**/api/v1/groups/friends/expenses", async (route) => {
    posted.push(route.request().postDataJSON() as ExpenseRequest);
    await commandResponse(route, "expense");
  });
  return posted;
}

interface ExpenseRequest {
  expense_id: string;
  payer_address: string;
  description: string;
  amount: { currency: string; minor_units: number };
  shares: Record<string, { currency: string; minor_units: number }>;
  intent: { action: string; resource_id: string };
}

type VaultOutcome =
  | { ok: true; actorAddress: string; manual?: boolean }
  | { ok: false; error: string };

async function mockVault(page: Page, outcome: VaultOutcome) {
  await page.addInitScript((outcome: VaultOutcome) => {
    window.addEventListener("message", (event) => {
      const message = event.data as {
        source?: string;
        type?: string;
        request_id?: string;
        intent?: Record<string, unknown>;
      };
      if (
        message.source !== "resfinance-page" ||
        message.type !== "SIGN_INTENT"
      )
        return;
      const intent = message.intent!;
      const respond = () =>
        window.postMessage(
          outcome.ok
            ? {
                source: "reswallet",
                version: 1,
                request_id: message.request_id,
                ok: true,
                result: {
                  version: 1,
                  intent_id: intent.intent_id,
                  action: intent.action,
                  actor_public_key: "e2e-public-key",
                  actor_address: outcome.actorAddress,
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
              }
            : {
                source: "reswallet",
                version: 1,
                request_id: message.request_id,
                ok: false,
                error: outcome.error,
              },
          window.location.origin,
        );
      if (outcome.ok && outcome.manual)
        (window as unknown as { approveVault(): void }).approveVault = respond;
      else respond();
    });
  }, outcome);
}

async function mockSession(page: Page, actorAddress: string) {
  await prepareWalletLogin(page, actorAddress);
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "resfinance-api" }),
    }),
  );
}

async function mockGroup(
  page: Page,
  members: { address: string; name: string }[],
  extras: {
    expenses?: unknown[];
    obligations?: unknown[];
    credit_balances?: Record<string, unknown>;
  } = {},
) {
  await page.route("**/api/v1/groups", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          group_id: "friends",
          name: "Friends",
          member_count: members.length,
          open_obligation_count: 0,
          projection_version: 2,
        },
      ]),
    });
  });
  await page.route("**/api/v1/groups/friends", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        group_id: "friends",
        name: "Friends",
        owner_address: members[0]!.address,
        members: members.map((member, index) => ({
          actor_address: member.address,
          display_name: member.name,
          active: true,
          source_event_id: `evt-member-${index}`,
        })),
        expenses: extras.expenses ?? [],
        obligations: extras.obligations ?? [],
        credit_balances: extras.credit_balances ?? {},
        notifications: [],
        provenance: {
          projection_version: 2,
          as_of_utc: "2026-10-14T17:00:00Z",
          source_event_ids: members.map((_, index) => `evt-member-${index}`),
        },
        credit_disclaimer:
          "Internal credits are non-redeemable, non-monetary, and have no cash value.",
      }),
    });
  });
}

function words(text: string): RegExp {
  const escaped = text
    .split(" ")
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${escaped.join("\\s+")}\\s*$`, "i");
}

function equalShare(form: Locator, name: string): Locator {
  return form
    .locator(".split-editor li")
    .filter({ has: form.page().getByLabel(`Include ${name}`) })
    .locator(".split-amount");
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
}

async function commandResponse(route: Route, label: string) {
  await route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      event_id: `evt-${label}`,
      projection_version: 1,
      occurred_at_utc: "2026-10-14T17:00:00Z",
      deduplicated: false,
      receipt_ids: [`receipt-${label}`],
    }),
  });
}
