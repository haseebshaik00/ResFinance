import { expect, test } from "@playwright/test";

const overview = {
  summary: {
    month: "2026-10",
    income: { currency: "USD", minor_units: 500000 },
    expense: { currency: "USD", minor_units: 90000 },
    balance: { currency: "USD", minor_units: 410000 },
    receivable: { currency: "USD", minor_units: 30000 },
    payable: { currency: "USD", minor_units: 20000 },
    outstanding_recurring_income: { currency: "USD", minor_units: 0 },
    outstanding_recurring_expense: { currency: "USD", minor_units: 150000 },
    savings: {
      actual: { currency: "USD", minor_units: 410000 },
      projected: { currency: "USD", minor_units: 270000 },
      available: { currency: "USD", minor_units: 270000 },
      formula_version: "finance-savings-v1",
      calculation_id: "savings_e2e",
      source_event_ids: [
        "evt_income",
        "evt_expense",
        "evt_recurring",
        "evt_payable",
        "evt_receivable",
      ],
    },
    budget_statuses: [
      {
        budget_id: "budget-groceries",
        category_id: "groceries",
        category_name: "Groceries",
        limit: { currency: "USD", minor_units: 100000 },
        spent: { currency: "USD", minor_units: 90000 },
        remaining: { currency: "USD", minor_units: 10000 },
        utilization_basis_points: 9000,
        status: "near_limit",
        source_event_ids: ["evt_budget", "evt_expense"],
      },
    ],
  },
  categories: [
    {
      category_id: "salary",
      name: "Salary",
      direction: "income",
      active: true,
      source_event_id: "evt_category_income",
    },
    {
      category_id: "groceries",
      name: "Groceries",
      direction: "expense",
      active: true,
      source_event_id: "evt_category_expense",
    },
  ],
  transactions: [
    {
      transaction_id: "paycheck",
      direction: "income",
      category_id: "salary",
      amount: { currency: "USD", minor_units: 500000 },
      occurred_on: "2026-10-01",
      description: "October salary",
      recurring_entry_id: null,
      voided: false,
      source_event_id: "evt_income",
    },
    {
      transaction_id: "groceries",
      direction: "expense",
      category_id: "groceries",
      amount: { currency: "USD", minor_units: 90000 },
      occurred_on: "2026-10-10",
      description: "October groceries",
      recurring_entry_id: null,
      voided: false,
      source_event_id: "evt_expense",
    },
  ],
  budgets: [
    {
      budget_id: "budget-groceries",
      category_id: "groceries",
      month: "2026-10",
      limit: { currency: "USD", minor_units: 100000 },
      active: true,
      source_event_id: "evt_budget",
    },
  ],
  recurring_entries: [
    {
      recurring_entry_id: "monthly-groceries",
      direction: "expense",
      category_id: "groceries",
      amount: { currency: "USD", minor_units: 150000 },
      description: "Expected monthly groceries",
      cadence: "monthly",
      starts_on: "2026-01-01",
      ends_on: null,
      active: true,
      source_event_id: "evt_recurring",
    },
  ],
  obligations: [
    {
      obligation_id: "group-payable",
      direction: "payable",
      amount: { currency: "USD", minor_units: 20000 },
      due_on: "2026-10-20",
      settled: false,
      source_event_id: "evt_payable",
      contract_receipt: "receipt_1",
    },
    {
      obligation_id: "group-receivable",
      direction: "receivable",
      amount: { currency: "USD", minor_units: 30000 },
      due_on: "2026-10-22",
      settled: false,
      source_event_id: "evt_receivable",
      contract_receipt: "receipt_2",
    },
  ],
  provenance: {
    projection_version: 8,
    as_of_utc: "2026-10-14T08:00:00Z",
    source_event_ids: [
      "evt_category_income",
      "evt_category_expense",
      "evt_income",
      "evt_expense",
      "evt_budget",
      "evt_recurring",
      "evt_payable",
      "evt_receivable",
    ],
  },
};

test("renders exact balances, budget alert, savings, and provenance", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "e2e-access-token",
        token_type: "Bearer",
        expires_at: "2026-10-14T08:10:00Z",
        actor_address: `0x${"a".repeat(40)}`,
      }),
    });
  });
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "resfinance-api" }),
    });
  });
  await page.route("**/api/v1/auth/sessions/current", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/finance/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overview),
    });
  });
  await page.route("**/api/v1/insights/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        month: "2026-10",
        fact_bundle_id: "facts_finance_e2e",
        insight: {
          summary: "Your recorded budget is on track for this month.",
          evidence: [
            {
              fact_id: "savings.available-2026-10",
              topic: "savings",
              statement: "Available savings for 2026-10 are $2,700.00.",
              source_kind: "finance-savings",
              source_ids: ["evt_income", "evt_expense"],
              as_of_utc: "2026-10-14T08:00:00Z",
            },
            {
              fact_id: "savings.actual-2026-10",
              topic: "savings",
              statement:
                "Recorded income minus recorded expenses for 2026-10 is $4,100.00.",
              source_kind: "finance-savings",
              source_ids: ["evt_income", "evt_expense"],
              as_of_utc: "2026-10-14T08:00:00Z",
            },
            {
              fact_id: "savings.projected-2026-10",
              topic: "savings",
              statement:
                "Projected savings after recurring items and due obligations are $2,700.00.",
              source_kind: "finance-savings",
              source_ids: ["evt_recurring", "evt_payable"],
              as_of_utc: "2026-10-14T08:00:00Z",
            },
          ],
          caveats: ["This is a read-only explanation of recorded data."],
          follow_up_questions: ["How can I improve my savings?"],
          mode: "template-fallback",
          model_id: "template",
          model_revision: "finance-e2e",
          refused: false,
        },
        notifications: [],
      }),
    });
  });

  await page.goto("/finance");

  await expect(
    page.getByRole("heading", { name: "Your money, in one view!" }),
  ).toBeVisible();
  await expect(
    page.locator("summary").filter({ hasText: /^Category$/ }),
  ).toHaveCount(0);
  const entryAccordion = page.locator(".entry-accordion");
  await expect(entryAccordion).toHaveCount(1);
  await expect(entryAccordion.locator("summary")).toContainText(
    "Add A Finance Record (Update Your Ledger)",
  );
  await expect(
    page.getByText("Add income, expenses, budgets, or recurring items"),
  ).toHaveCount(0);
  await entryAccordion.locator("summary").click();
  const transactionForm = entryAccordion.locator(".transaction-form");
  await expect(
    transactionForm.getByLabel("Category").locator("option"),
  ).toHaveText([
    "Choose category",
    "Rent",
    "Utilities",
    "Shopping",
    "Entertainment",
    "Food & Groceries",
    "Medical Bills",
    "Miscellaneous",
  ]);
  await transactionForm.getByLabel("Type").selectOption("income");
  await expect(
    transactionForm.getByLabel("Category").locator("option"),
  ).toHaveText([
    "Choose category",
    "Salary",
    "Liquid Funds Transfer",
    "Other Sources",
  ]);
  await expect(
    page.getByRole("button", { name: "Switch to Light Mode" }),
  ).toBeVisible();
  const topBar = page.locator(".auth-card");
  await expect(
    topBar.getByRole("heading", { name: "ResFinance" }),
  ).toBeVisible();
  const homeButton = topBar.getByRole("button", {
    name: "ResFinance",
    exact: true,
  });
  await expect(homeButton).toHaveAttribute(
    "title",
    "Log out and return to the ResFinance welcome screen",
  );
  await expect(topBar.locator(".auth-brand-logo-light")).toHaveAttribute(
    "src",
    "/favicon.png",
  );
  await expect(topBar.locator(".auth-brand-logo-dark")).toHaveAttribute(
    "src",
    "/favicon-dark.png",
  );
  await expect(topBar.locator(".auth-brand-logo-dark")).toBeVisible();
  await expect(topBar.locator(".auth-brand-logo-light")).not.toBeVisible();
  const dashboardNavigation = topBar.getByRole("navigation", {
    name: "ResFinance dashboards",
  });
  await expect(dashboardNavigation.getByRole("link")).toHaveCount(3);
  await expect(
    dashboardNavigation.getByRole("link", { name: "Personal Finance" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    dashboardNavigation.getByRole("link", {
      name: "Crypto Intelligence",
      exact: true,
    }),
  ).toBeVisible();
  await expect(topBar.getByLabel("No in-app notifications")).toBeVisible();
  await expect(topBar.locator(".notification-bell")).toBeVisible();
  await expect(topBar.locator(".notification-bell")).toHaveCSS(
    "color",
    "rgb(242, 189, 90)",
  );
  const githubLink = topBar.getByRole("link", {
    name: "Open ResFinance repository on GitHub",
  });
  await expect(githubLink).toHaveAttribute(
    "href",
    "https://github.com/haseebshaik00/ResFinance",
  );
  await expect(githubLink).toHaveAttribute("target", "_blank");
  await expect(githubLink.locator(".github-icon")).toBeVisible();
  await expect(
    topBar
      .getByRole("button", { name: "Log out" })
      .locator(".auth-action-icon"),
  ).toBeVisible();
  await expect(
    topBar
      .getByRole("button", { name: "Log out" })
      .locator(".auth-action-icon"),
  ).toHaveCSS("color", "rgb(255, 140, 160)");
  await expect(topBar.locator(".theme-slider-track")).toBeVisible();
  await expect(topBar.getByText("Log out", { exact: true })).toHaveCount(0);
  await expect(topBar.getByText(/^(Light|Dark) Mode$/)).toHaveCount(0);
  await expect(page.getByText(/milestone/i)).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.png",
  );
  const sessionCardBox = await page.locator(".auth-card").boundingBox();
  const githubLinkBox = await githubLink.boundingBox();
  const logoutButtonBox = await page
    .getByRole("button", { name: "Log out" })
    .boundingBox();
  const notificationButtonBox = await topBar
    .getByLabel("No in-app notifications")
    .boundingBox();
  const notificationBellBox = await topBar
    .locator(".notification-bell")
    .boundingBox();
  const dashboardNavigationBox = await dashboardNavigation.boundingBox();
  const themeToggleBox = await page
    .getByRole("button", { name: "Switch to Light Mode" })
    .boundingBox();
  expect(sessionCardBox).not.toBeNull();
  expect(githubLinkBox).not.toBeNull();
  expect(logoutButtonBox).not.toBeNull();
  expect(notificationButtonBox).not.toBeNull();
  expect(notificationBellBox).not.toBeNull();
  expect(dashboardNavigationBox).not.toBeNull();
  expect(themeToggleBox).not.toBeNull();
  expect(dashboardNavigationBox!.width).toBeGreaterThan(450);
  expect(githubLinkBox!.x + githubLinkBox!.width).toBeLessThanOrEqual(
    themeToggleBox!.x,
  );
  expect(themeToggleBox!.x + themeToggleBox!.width).toBeLessThanOrEqual(
    notificationButtonBox!.x,
  );
  expect(
    notificationButtonBox!.x + notificationButtonBox!.width,
  ).toBeLessThanOrEqual(logoutButtonBox!.x);
  expect(
    notificationButtonBox!.width - notificationBellBox!.width,
  ).toBeGreaterThanOrEqual(16);
  expect(logoutButtonBox!.x + logoutButtonBox!.width).toBeLessThanOrEqual(
    sessionCardBox!.x + sessionCardBox!.width,
  );
  expect(
    Math.abs(themeToggleBox!.height - notificationButtonBox!.height),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(githubLinkBox!.height - themeToggleBox!.height),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(themeToggleBox!.height - logoutButtonBox!.height),
  ).toBeLessThanOrEqual(1);
  expect(themeToggleBox!.y).toBeGreaterThanOrEqual(sessionCardBox!.y);
  expect(themeToggleBox!.y + themeToggleBox!.height).toBeLessThanOrEqual(
    sessionCardBox!.y + sessionCardBox!.height,
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".theme-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(topBar.locator(".auth-brand-logo-light")).toBeVisible();
  await expect(topBar.locator(".auth-brand-logo-dark")).not.toBeVisible();
  await expect(page.locator(".theme-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.screenshot({
    path: "test-results/finance-dashboard-light.png",
    fullPage: false,
  });
  await expect(
    page.getByRole("button", { name: "Switch to Dark Mode" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to Dark Mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(topBar.locator(".auth-brand-logo-dark")).toBeVisible();

  await expect(
    page.getByRole("button", {
      name: "How to use the Personal Finance dashboard",
    }),
  ).toHaveCSS("color", "rgb(242, 189, 90)");

  await page.setViewportSize({ width: 375, height: 812 });
  const compactSessionCardBox = await page.locator(".auth-card").boundingBox();
  const compactThemeToggleBox = await page
    .getByRole("button", { name: "Switch to Light Mode" })
    .boundingBox();
  expect(compactSessionCardBox).not.toBeNull();
  expect(compactThemeToggleBox).not.toBeNull();
  expect(
    compactThemeToggleBox!.x + compactThemeToggleBox!.width,
  ).toBeLessThanOrEqual(
    compactSessionCardBox!.x + compactSessionCardBox!.width,
  );
  expect(compactThemeToggleBox!.y).toBeGreaterThanOrEqual(
    compactSessionCardBox!.y,
  );
  expect(
    compactThemeToggleBox!.y + compactThemeToggleBox!.height,
  ).toBeLessThanOrEqual(
    compactSessionCardBox!.y + compactSessionCardBox!.height,
  );
  await page.screenshot({
    path: "test-results/finance-dashboard-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByText("$4,100.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$5,000.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("$900.00", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("$2,700.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Current balance", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("All Recorded Cash Flow")).toBeVisible();
  await expect(page.getByText("Total Earned This Month")).toBeVisible();
  await expect(page.getByText("Total Spent This Month")).toBeVisible();
  await expect(page.getByLabel("Projected savings calculation")).toBeVisible();
  await expect(page.getByText("Here Savings (Projected) is defined as:")).toBeVisible();
  await expect(page.getByText("Near the limit")).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Groceries budget utilization" }),
  ).toHaveAttribute("value", "9000");
  await expect(
    page.getByRole("progressbar", { name: "Groceries budget utilization" }),
  ).toHaveCSS("accent-color", "rgb(255, 140, 160)");
  await expect(
    page.getByRole("img", { name: /Income \$5,000.00/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your Financial Trends" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your Financial Activity" }),
  ).toBeVisible();
  await expect(
    page.getByText("Monthly money management", { exact: true }),
  ).toHaveCSS("color", "rgb(56, 209, 197)");
  const dashboardSectionHeadings = page.locator(".dashboard-section-heading");
  await expect(dashboardSectionHeadings).toHaveCount(3);
  const sectionTitleStyles = await dashboardSectionHeadings
    .locator("h2")
    .evaluateAll((titles) =>
      titles.map((title) => {
        const style = getComputedStyle(title);
        return {
          fontSize: style.fontSize,
          letterSpacing: style.letterSpacing,
          marginBottom: style.marginBottom,
          marginTop: style.marginTop,
        };
      }),
    );
  expect(new Set(sectionTitleStyles.map(JSON.stringify)).size).toBe(1);
  const sectionKickerStyles = await dashboardSectionHeadings
    .locator(".section-kicker")
    .evaluateAll((kickers) =>
      kickers.map((kicker) => {
        const style = getComputedStyle(kicker);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          marginBottom: style.marginBottom,
        };
      }),
    );
  expect(new Set(sectionKickerStyles.map(JSON.stringify)).size).toBe(1);
  const sectionDescriptionStyles = await dashboardSectionHeadings
    .locator("p:not(.section-kicker)")
    .evaluateAll((descriptions) =>
      descriptions.map((description) => {
        const style = getComputedStyle(description);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          marginTop: style.marginTop,
        };
      }),
    );
  expect(new Set(sectionDescriptionStyles.map(JSON.stringify)).size).toBe(1);
  const trendsHeadingBox = await page
    .getByRole("heading", { name: "Your Financial Trends" })
    .boundingBox();
  const trendsDescriptionBox = await page
    .getByText(
      "Charts use your recorded ledger and upcoming recurring commitments.",
      { exact: true },
    )
    .boundingBox();
  expect(trendsHeadingBox).not.toBeNull();
  expect(trendsDescriptionBox).not.toBeNull();
  expect(trendsDescriptionBox!.y).toBeGreaterThan(
    trendsHeadingBox!.y + trendsHeadingBox!.height,
  );
  await expect(
    page.getByRole("heading", { name: "Spending by category" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Balance through the month" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cash flow over time" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Savings breakdown" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Budget utilization" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Savings outlook" }),
  ).toHaveCount(0);
  const analyticsCards = page.locator(".analytics-grid > .analytics-card");
  await expect(analyticsCards).toHaveCount(3);
  const analyticsCardTopEdges = await analyticsCards.evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().top)),
  );
  expect(new Set(analyticsCardTopEdges).size).toBe(1);
  const balancePathCard = page.locator(".analytics-card", {
    has: page.getByRole("heading", { name: "Balance through the month" }),
  });
  await expect(
    balancePathCard.getByText("Running ledger balance by day"),
  ).toBeVisible();
  await expect(balancePathCard.locator(".recharts-area")).toHaveCount(1);
  await expect(balancePathCard.locator(".recharts-bar")).toHaveCount(0);
  await expect(
    balancePathCard.getByRole("img", {
      name: /Balance through the month ending at \$4,100\.00/,
    }),
  ).toBeVisible();
  const cashFlowTrendCard = page.locator(".analytics-card", {
    has: page.getByRole("heading", { name: "Cash flow over time" }),
  });
  await expect(cashFlowTrendCard.locator(".recharts-line")).toHaveCount(3);
  await expect(cashFlowTrendCard.locator(".recharts-bar")).toHaveCount(0);
  await expect(
    cashFlowTrendCard.getByText("Exactly six reporting months"),
  ).toBeVisible();
  const entryCards = entryAccordion.locator(".entry-form-card");
  await expect(entryCards).toHaveCount(3);
  const entryCardHeights = await entryCards.evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().height)),
  );
  expect(new Set(entryCardHeights).size).toBe(1);
  await expect(page.locator(".finance-activity .entry-panel")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(entryAccordion).toHaveCSS("border-top-width", "2px");
  await expect(entryAccordion.locator("summary > span")).toHaveCSS(
    "color",
    "rgb(242, 189, 90)",
  );
  await expect(
    entryAccordion.getByRole("button", { name: "Save transaction" }),
  ).toHaveCSS("background-color", "rgb(255, 140, 160)");
  await expect(
    entryAccordion.getByRole("button", { name: "Save budget" }),
  ).toHaveCSS("background-color", "rgb(242, 189, 90)");
  await expect(
    entryAccordion.getByRole("button", { name: "Save recurring item" }),
  ).toHaveCSS("background-color", "rgb(70, 214, 189)");
  const overviewPanels = page.locator(
    ".finance-overview-row > .overview-panel",
  );
  await expect(overviewPanels).toHaveCount(3);
  const overviewPanelTopEdges = await overviewPanels.evaluateAll((panels) =>
    panels.map((panel) => Math.round(panel.getBoundingClientRect().top)),
  );
  expect(new Set(overviewPanelTopEdges).size).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Budgets & Commitments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Smart Savings Insights" }),
  ).toBeVisible();
  await expect(
    page.getByText("Evidence-linked guidance", { exact: true }).last(),
  ).toHaveCSS("color", "rgb(56, 209, 197)");
  const entryFollowsSummary = await page
    .locator(".summary-grid")
    .evaluate((node) =>
      Boolean(
        node.compareDocumentPosition(
          document.querySelector(".entry-panel") as Node,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    );
  expect(entryFollowsSummary).toBe(true);
  const chartsFollowEntry = await page
    .locator(".entry-panel")
    .evaluate((node) =>
      Boolean(
        node.compareDocumentPosition(
          document.querySelector(".finance-overview-row") as Node,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    );
  expect(chartsFollowEntry).toBe(true);
  const suggestedQuestions = page
    .locator(".insight-composer")
    .getByRole("group", { name: "Suggested questions" });
  await expect(suggestedQuestions.getByRole("button")).toHaveCount(4);
  await expect(suggestedQuestions.locator(".lucide-lightbulb")).toHaveCount(4);
  await expect(
    page.getByRole("button", {
      name: "What are my biggest expenses this month?",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified template fallback", { exact: true }),
  ).toHaveCSS("color", "rgb(242, 189, 90)");
  const suggestionBoxes = await suggestedQuestions
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y) };
      }),
    );
  expect(suggestionBoxes[0]!.y).toBe(suggestionBoxes[1]!.y);
  expect(suggestionBoxes[1]!.x).toBeGreaterThan(suggestionBoxes[0]!.x);
  expect(suggestionBoxes[2]!.y).toBeGreaterThan(suggestionBoxes[0]!.y);
  expect(suggestionBoxes[2]!.y).toBe(suggestionBoxes[3]!.y);
  expect(suggestionBoxes[3]!.x).toBeGreaterThan(suggestionBoxes[2]!.x);
  const evidenceItems = page.locator(".evidence-list > li");
  await expect(evidenceItems).toHaveCount(4);
  await expect(
    page.locator(".evidence-list > li.evidence-card-empty"),
  ).toHaveCount(1);
  const evidenceItemTopEdges = await evidenceItems.evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  );
  expect(new Set(evidenceItemTopEdges).size).toBe(2);
  const insightsWorkspaceBox = await page
    .locator(".insights-workspace")
    .boundingBox();
  expect(insightsWorkspaceBox).not.toBeNull();
  expect(insightsWorkspaceBox!.height).toBeLessThan(520);
  await expect(
    page.locator(".insight-result").getByRole("group", {
      name: "Suggested questions",
    }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "How to use the Personal Finance dashboard" })
    .click();
  const dashboardGuide = page.getByRole("dialog", {
    name: "How to use this dashboard",
  });
  await expect(dashboardGuide).toBeVisible();
  await expect(
    dashboardGuide.getByText("Actual savings", { exact: true }),
  ).toBeVisible();
  await expect(
    dashboardGuide.getByText("Projected savings", { exact: true }),
  ).toBeVisible();
  await expect(
    dashboardGuide.getByText("Available savings", { exact: true }),
  ).toBeVisible();
  await expect(dashboardGuide.locator("li")).toHaveCount(7);
  const guideFontSizes = await dashboardGuide
    .locator(
      ".dashboard-guide-points, .savings-conventions ul, .dashboard-guide-note",
    )
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).fontSize),
    );
  expect(new Set(guideFontSizes)).toEqual(new Set(["14.4px"]));
  await expect(
    dashboardGuide.getByText("Available savings", { exact: true }),
  ).toHaveCSS("color", "rgb(255, 140, 160)");
  await page.screenshot({
    path: "test-results/finance-dashboard-guide.png",
    fullPage: false,
  });
  await dashboardGuide
    .getByRole("button", { name: "Close dashboard guide" })
    .click();
  await expect(dashboardGuide).not.toBeVisible();
  await expect(
    page.locator(".chart-panel").getByText("Projection v8", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".summary-grid")
      .getByText("finance-savings-v1", { exact: true }),
  ).toHaveCount(0);

  await expect(
    page.locator(".finance-dashboard > .provenance-panel"),
  ).toHaveCount(1);
  const provenanceSummary = page.locator(
    ".finance-dashboard > .provenance-panel summary",
  );
  await expect(provenanceSummary).toHaveCSS("color", "rgb(242, 189, 90)");
  await provenanceSummary.click();
  await expect(
    page.getByRole("heading", { name: "Finance Insights" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Savings Insights", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Finance Insights" }),
  ).toHaveCSS("color", "rgb(255, 140, 160)");
  await expect(
    page.getByRole("heading", { name: "Savings Insights", exact: true }),
  ).toHaveCSS("color", "rgb(255, 140, 160)");
  const financeProvenanceBox = await page
    .getByRole("heading", { name: "Finance Insights" })
    .boundingBox();
  const savingsProvenanceBox = await page
    .getByRole("heading", { name: "Savings Insights", exact: true })
    .boundingBox();
  expect(financeProvenanceBox).not.toBeNull();
  expect(savingsProvenanceBox).not.toBeNull();
  expect(savingsProvenanceBox!.x).toBeGreaterThan(financeProvenanceBox!.x);
  expect(
    Math.abs(savingsProvenanceBox!.y - financeProvenanceBox!.y),
  ).toBeLessThan(2);
  await expect(page.getByText(/Projection v8 rebuilt through/)).toBeVisible();
  await expect(page.getByText(/Fact bundle facts_finance_e2e/)).toBeVisible();
  await expect(
    page.getByText("finance-savings-v1", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("savings_e2e")).toBeVisible();
  await expect(page.getByText(/5 source event/)).toBeVisible();
  await page.screenshot({
    path: "test-results/finance-dashboard.png",
    fullPage: true,
  });

  await homeButton.click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(
    page.getByRole("heading", { name: "ResFinance", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect ResWallet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your money, in one view!" }),
  ).toHaveCount(0);

  await page.goto("/finance");
  await expect(
    page.getByRole("heading", { name: "Your money, in one view!" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(
    page.getByRole("heading", { name: "ResFinance", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect ResWallet" }),
  ).toBeVisible();
  const loggedOutCard = page.locator(".auth-card");
  await expect(
    loggedOutCard.getByRole("link", {
      name: "Open ResFinance repository on GitHub",
    }),
  ).toHaveCount(0);
  await expect(
    loggedOutCard.getByRole("button", { name: "Log out" }),
  ).toHaveCount(0);
  await expect(loggedOutCard.locator(".theme-toggle")).toHaveCount(0);
  await expect(
    page.getByText("Private finance · Read-only insights"),
  ).toHaveCount(0);
  await expect(page.locator(".status-card")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/logged-out-screen.png",
    fullPage: false,
  });
});

test("voids transactions and deactivates recurring items and budgets through confirmed audit events", async ({
  page,
}) => {
  const currentOverview = structuredClone(overview);

  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "e2e-access-token",
        token_type: "Bearer",
        expires_at: "2026-10-19T20:10:00Z",
        actor_address: `0x${"a".repeat(40)}`,
      }),
    });
  });
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "resfinance-api" }),
    });
  });
  await page.route("**/api/v1/auth/sessions/current", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/insights/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        month: "2026-10",
        fact_bundle_id: "facts_finance_actions",
        insight: {
          summary: "Your recorded budget is on track for this month.",
          evidence: [],
          caveats: [],
          follow_up_questions: [],
          mode: "template-fallback",
          model_id: "template",
          model_revision: "finance-actions",
          refused: false,
        },
        notifications: [],
      }),
    });
  });
  await page.route("**/api/v1/finance/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(currentOverview),
    });
  });

  let voidRequest: Record<string, unknown> | null = null;
  await page.route(
    "**/api/v1/finance/transactions/groceries/void",
    async (route) => {
      voidRequest = route.request().postDataJSON() as Record<string, unknown>;
      currentOverview.transactions[1].voided = true;
      currentOverview.summary.expense.minor_units = 0;
      currentOverview.summary.balance.minor_units = 500000;
      currentOverview.summary.savings.actual.minor_units = 500000;
      currentOverview.provenance.projection_version = 9;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          event_id: "evt_void_expense",
          projection_version: 9,
          occurred_at_utc: "2026-10-19T20:00:00Z",
          deduplicated: false,
          receipt_ids: [],
        }),
      });
    },
  );

  let removeBudgetRequest: Record<string, unknown> | null = null;
  await page.route(
    "**/api/v1/finance/budgets/budget-groceries/deactivate",
    async (route) => {
      removeBudgetRequest = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      currentOverview.budgets[0].active = false;
      currentOverview.summary.budget_statuses = [];
      currentOverview.provenance.projection_version = 11;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          event_id: "evt_deactivate_budget",
          projection_version: 11,
          occurred_at_utc: "2026-10-19T20:02:00Z",
          deduplicated: false,
          receipt_ids: [],
        }),
      });
    },
  );

  let deactivateRequest: Record<string, unknown> | null = null;
  await page.route(
    "**/api/v1/finance/recurring/monthly-groceries/deactivate",
    async (route) => {
      deactivateRequest = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      currentOverview.recurring_entries[0].active = false;
      currentOverview.provenance.projection_version = 10;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          event_id: "evt_deactivate_recurring",
          projection_version: 10,
          occurred_at_utc: "2026-10-19T20:01:00Z",
          deduplicated: false,
          receipt_ids: [],
        }),
      });
    },
  );

  await page.goto("/finance");

  const voidButton = page.getByRole("button", {
    name: "Void transaction October groceries",
  });
  const actionsHeadingBox = await page
    .getByRole("columnheader", { name: "Actions" })
    .boundingBox();
  const voidButtonBox = await voidButton.boundingBox();
  expect(actionsHeadingBox).not.toBeNull();
  expect(voidButtonBox).not.toBeNull();
  expect(
    Math.abs(
      actionsHeadingBox!.x +
        actionsHeadingBox!.width / 2 -
        (voidButtonBox!.x + voidButtonBox!.width / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(voidButton.locator(".lucide-archive-x")).toHaveAttribute(
    "stroke",
    "#FF6B4A",
  );
  await expect(voidButton.locator(".lucide-archive-x")).toHaveAttribute(
    "width",
    "18",
  );
  await voidButton.click();
  const voidDialog = page.getByRole("dialog", {
    name: "Void this transaction?",
  });
  await expect(voidDialog).toBeVisible();
  await expect(
    voidDialog.getByText(
      /original record remains in the append-only audit trail/i,
    ),
  ).toBeVisible();
  await expect(
    voidDialog.getByRole("button", { name: "Void Transaction" }),
  ).toBeDisabled();
  await voidDialog
    .getByLabel("Reason for voiding")
    .fill("Duplicate transaction");
  await voidDialog.getByRole("button", { name: "Void Transaction" }).click();

  await expect(
    page.getByText("October groceries", { exact: true }),
  ).toHaveCount(0);
  expect(voidRequest).toEqual({
    reason: "Duplicate transaction",
    expected_version: 8,
  });
  await expect(
    page.locator(".metric-card").filter({
      has: page.getByText("Expenses", { exact: true }),
    }),
  ).toContainText("$0.00");

  const deactivateButton = page.getByRole("button", {
    name: "Deactivate recurring item Expected monthly groceries",
  });
  await expect(deactivateButton.locator(".lucide-archive-x")).toHaveAttribute(
    "stroke",
    "#FF6B4A",
  );
  await expect(deactivateButton.locator(".lucide-archive-x")).toHaveAttribute(
    "width",
    "18",
  );
  await deactivateButton.click();
  const deactivateDialog = page.getByRole("dialog", {
    name: "Deactivate this recurring item?",
  });
  await expect(deactivateDialog).toBeVisible();
  await deactivateDialog
    .getByRole("button", { name: "Deactivate Recurring Item" })
    .click();

  await expect(
    page.getByText("Expected monthly groceries", { exact: true }),
  ).toHaveCount(0);
  expect(deactivateRequest).toEqual({ expected_version: 9 });

  const removeBudgetButton = page.getByRole("button", {
    name: "Remove budget Groceries",
  });
  await removeBudgetButton.click();
  const removeBudgetDialog = page.getByRole("dialog", {
    name: "Remove this budget?",
  });
  await expect(removeBudgetDialog).toBeVisible();
  await expect(
    removeBudgetDialog.getByText(/original record remains/i),
  ).toBeVisible();
  await removeBudgetDialog
    .getByRole("button", { name: "Remove Budget" })
    .click();

  await expect(
    page.getByRole("progressbar", { name: "Groceries budget utilization" }),
  ).toHaveCount(0);
  expect(removeBudgetRequest).toEqual({ expected_version: 10 });
});

test("separates the wallet controls before a wallet is created", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({ status: 401 });
  });
  await page.goto("/");

  const card = page.locator(".auth-card");
  const connect = page.getByRole("button", { name: "Connect Wallet" });
  const help = page.getByRole("button", { name: "How to connect ResWallet" });
  await expect(card).toHaveAttribute("data-state", "disconnected");
  await expect(
    page.getByText(
      "Install the ResWallet extension to use wallet authentication.",
    ),
  ).toBeVisible();
  await expect(connect).toBeDisabled();

  const cardBox = await card.boundingBox();
  const connectBox = await connect.boundingBox();
  const helpBox = await help.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(connectBox).not.toBeNull();
  expect(helpBox).not.toBeNull();
  expect(cardBox!.height).toBeGreaterThanOrEqual(168);
  expect(connectBox!.y - (helpBox!.y + helpBox!.height)).toBeGreaterThanOrEqual(
    8,
  );
  await page.screenshot({
    path: "test-results/reswallet-disconnected.png",
    fullPage: false,
  });

  await page.evaluate(() => {
    window.postMessage(
      {
        source: "reswallet",
        version: 1,
        type: "STATUS_CHANGED",
        status: { exists: false, unlocked: false, identity: null },
      },
      window.location.origin,
    );
  });
  await expect(
    page.getByText("Initialize ResWallet before connecting..."),
  ).toBeVisible();
  await expect(card).toHaveAttribute("data-state", "disconnected");
});

test("updates the ResWallet login guidance after the popup changes wallet state", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({ status: 401 });
  });
  await page.addInitScript(() => {
    const identity = {
      public_key: "e2e-public-key",
      address: `0x${"6".repeat(40)}`,
    };
    const testWindow = window as typeof window & {
      __reswalletStatus?: {
        exists: boolean;
        unlocked: boolean;
        identity: typeof identity;
      };
      __reswalletApproval?: {
        request_id: string;
        intent: Record<string, unknown>;
      };
    };
    testWindow.__reswalletStatus = {
      exists: true,
      unlocked: false,
      identity,
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
        request.version !== 1
      ) {
        return;
      }
      if (
        request.type === "SIGN_INTENT" &&
        request.request_id !== undefined &&
        request.intent !== undefined
      ) {
        testWindow.__reswalletApproval = {
          request_id: request.request_id,
          intent: request.intent,
        };
        return;
      }
      if (request.type !== "GET_STATUS") return;
      window.postMessage(
        {
          source: "reswallet",
          version: 1,
          request_id: request.request_id,
          ok: true,
          result: testWindow.__reswalletStatus,
        },
        window.location.origin,
      );
    });
  });

  await page.goto("/");

  const authCard = page.locator(".auth-card");
  await expect(page.getByText("ResWallet is Locked!")).toBeVisible();
  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(authCard.locator(".auth-message")).toHaveCSS(
    "color",
    "rgb(91, 71, 153)",
  );
  await page.screenshot({
    path: "test-results/reswallet-login-light.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Switch to Dark Mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".auth-status-bulb")).toBeVisible();
  await expect(authCard.locator(".auth-brand-logo-dark")).toBeVisible();
  await expect(
    authCard.getByRole("link", {
      name: "Open ResFinance repository on GitHub",
    }),
  ).toHaveCount(0);
  await expect(authCard.getByRole("button", { name: "Log out" })).toHaveCount(
    0,
  );
  await expect(authCard.locator(".theme-toggle")).toHaveCount(0);
  await expect(page.getByText("Your Wallet Address:")).toBeVisible();
  await expect(page.locator(".wallet-address")).toHaveText(
    `0x${"6".repeat(40)}`,
  );
  await expect(
    page.getByRole("button", { name: "Connect Wallet" }),
  ).toBeDisabled();

  const cardBox = await authCard.boundingBox();
  const sessionBox = await authCard.locator(".auth-session").boundingBox();
  const connectBox = await page
    .getByRole("button", { name: "Connect Wallet" })
    .boundingBox();
  const helpBox = await page
    .getByRole("button", { name: "How to connect ResWallet" })
    .boundingBox();
  expect(cardBox).not.toBeNull();
  expect(sessionBox).not.toBeNull();
  expect(connectBox).not.toBeNull();
  expect(helpBox).not.toBeNull();
  expect(sessionBox!.x - cardBox!.x).toBeGreaterThanOrEqual(20);
  expect(connectBox!.x).toBeGreaterThan(sessionBox!.x + sessionBox!.width);
  expect(
    Math.abs(
      connectBox!.y +
        connectBox!.height / 2 -
        (sessionBox!.y + sessionBox!.height / 2),
    ),
  ).toBeLessThanOrEqual(2);
  expect(helpBox!.y - cardBox!.y).toBeGreaterThanOrEqual(12);
  expect(helpBox!.y - cardBox!.y).toBeLessThanOrEqual(24);
  expect(connectBox!.y - (helpBox!.y + helpBox!.height)).toBeGreaterThanOrEqual(
    0,
  );
  expect(
    Math.abs(connectBox!.x + connectBox!.width - (helpBox!.x + helpBox!.width)),
  ).toBeLessThanOrEqual(2);
  expect(
    cardBox!.x + cardBox!.width - (helpBox!.x + helpBox!.width),
  ).toBeGreaterThanOrEqual(12);

  const helpButton = page.getByRole("button", {
    name: "How to connect ResWallet",
  });
  await helpButton.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Install and enable the ResWallet extension",
  );
  await expect(page.getByRole("tooltip")).toContainText("Approve & Login");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "test-results/reswallet-login-help.png",
    fullPage: false,
  });

  const githubLink = page.getByRole("link", {
    name: "Open ResFinance repository on GitHub",
  });
  const themeToggle = page.getByRole("button", {
    name: "Switch to Light Mode",
  });
  const githubBox = await githubLink.boundingBox();
  const themeBox = await themeToggle.boundingBox();
  expect(githubBox).not.toBeNull();
  expect(themeBox).not.toBeNull();
  expect(githubBox!.x + githubBox!.width).toBeLessThanOrEqual(themeBox!.x);

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __reswalletStatus?: {
        exists: boolean;
        unlocked: boolean;
        identity: { public_key: string; address: string };
      };
    };
    testWindow.__reswalletStatus = {
      exists: true,
      unlocked: true,
      identity: {
        public_key: "e2e-public-key",
        address: `0x${"6".repeat(40)}`,
      },
    };
    window.dispatchEvent(new Event("focus"));
  });

  await expect(
    page.getByText("ResWallet Unlocked! Connect to Wallet now..."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Wallet" }),
  ).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await page.screenshot({
    path: "test-results/reswallet-login-ready.png",
    fullPage: false,
  });

  await page.route("**/api/v1/auth/challenges", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        audience: "resfinance-api",
        challenge: "e2e-login-challenge",
        challenge_id: "challenge-e2e",
        expires_at: "2026-10-21T06:00:00Z",
        network_id: "pinned-local-network",
      }),
    });
  });
  await page.route("**/api/v1/auth/sessions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "e2e-login-token",
        actor_address: `0x${"6".repeat(40)}`,
        expires_at: "2026-10-21T06:00:00Z",
        token_type: "Bearer",
      }),
    });
  });

  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(
    page.getByText("Review and approve the sign-in request in ResWallet!"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waiting for approval…" }),
  ).toBeDisabled();

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(100);
  await expect(
    page.getByText("Review and approve the sign-in request in ResWallet!"),
  ).toBeVisible();
  await expect(
    page.getByText("ResWallet Unlocked! Connect to Wallet now..."),
  ).toHaveCount(0);

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __reswalletApproval?: {
        request_id: string;
        intent: Record<string, unknown>;
      };
    };
    const approval = testWindow.__reswalletApproval;
    if (approval === undefined) throw new Error("approval request is missing");
    window.postMessage(
      {
        source: "reswallet",
        version: 1,
        request_id: approval.request_id,
        ok: true,
        result: {
          ...approval.intent,
          actor_public_key: "e2e-public-key",
          actor_address: `0x${"6".repeat(40)}`,
          signature: "e2e-signature",
        },
      },
      window.location.origin,
    );
  });

  await Promise.all([
    expect(
      page.getByText("Approval Received! Signing you in to ResFinance…"),
    ).toBeVisible(),
    expect(page.getByRole("button", { name: "Signing in…" })).toBeDisabled(),
  ]);
  await expect(page.getByRole("button", { name: "ResFinance" })).toBeVisible();
});
