import { expect, test } from "@playwright/test";

import { approveWalletLogin, prepareWalletLogin } from "./wallet-login";

test("shows the promotion gate and records a versioned risk profile", async ({
  page,
}) => {
  await prepareWalletLogin(page);
  let profileSaved = false;
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
  await page.route("**/api/v1/crypto/risk-profile", async (route) => {
    profileSaved = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        event_id: "evt_risk_e2e",
        projection_version: 1,
        occurred_at_utc: "2026-10-14T08:00:00Z",
        deduplicated: false,
      }),
    });
  });
  await page.route("**/api/v1/crypto/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        month: "2026-10",
        risk_profile: profileSaved
          ? {
              answers: {
                investment_horizon: 2,
                risk_tolerance: 2,
                liquidity_needs: 2,
              },
              score: 67,
              policy_version: "risk-questionnaire-v2",
              source_event_id: "evt_risk_e2e",
              recorded_at_utc: "2026-10-14T08:00:00Z",
            }
          : null,
        risk_projection_version: profileSaved ? 1 : 0,
        forecast: null,
        recommendation: null,
        default_capital: { currency: "USD", minor_units: 270000 },
        savings_formula_version: "finance-savings-v1",
        savings_calculation_id: "savings_e2e",
        savings_source_event_ids: ["evt_income", "evt_expense"],
      }),
    });
  });
  await page.goto("/crypto");
  await approveWalletLogin(page);

  await expect(
    page.getByRole("link", { name: "Crypto Intelligence", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Savings, translated into choices!" }),
  ).toBeVisible();
  const capitalCard = page.locator(".capital-card");
  await expect(
    capitalCard.getByText("$2,700.00", { exact: true }),
  ).toBeVisible();
  await expect(
    capitalCard.getByRole("button", { name: "Edit scenario amount" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".summary-grid")
      .getByText("finance-savings-v1", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Policy v1", { exact: true })).toHaveCount(0);
  await page.getByText("Data Freshness and Provenance").click();
  await expect(
    page.getByText(
      /Formula finance-savings-v1; Finance calculation savings_e2e/,
    ),
  ).toBeVisible();
  await expect(page.getByText("savings_e2e")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "No forecast is eligible for portfolio use.",
    }),
  ).toBeVisible();
  const savingsMonth = page.getByRole("button", { name: /Savings month/ });
  await savingsMonth.click();
  const savingsMonthMenu = page.getByRole("dialog", {
    name: "Choose savings month",
  });
  await expect(savingsMonthMenu).toBeVisible();
  await savingsMonthMenu.getByRole("button", { name: "Oct" }).click();
  await expect(savingsMonth).toHaveAccessibleName("Savings month October 2026");
  await expect(savingsMonthMenu).toHaveCount(0);
  await expect(
    page.getByText(/No forecast has passed the required quality checks/),
  ).toBeVisible();
  await expect(page.getByText(/milestone/i)).toHaveCount(0);
  await expect(
    capitalCard.getByText(
      "Read Only · Edit the amount to explore other scenarios",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Analyze Another Amount" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Save risk profile" }).click();
  await expect(page.getByText("Score 67", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/crypto-dashboard.png",
    fullPage: true,
  });
});

test("renders promoted forecast overlays and reconciled allocations", async ({
  page,
}) => {
  await prepareWalletLogin(page);
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
  const priceHistory = ["BTC", "ETH", "SOL"].flatMap((asset, assetIndex) =>
    [10, 11, 12, 13, 14].map((day, index) => ({
      asset,
      observed_at_utc: `2026-10-${day}T00:00:00Z`,
      price_usd: String((assetIndex + 1) * 100 + index * 2),
      source_record_id: `${asset.toLowerCase()}-${day}`,
    })),
  );
  await page.route("**/api/v1/crypto/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        month: "2026-10",
        risk_profile: {
          answers: {
            investment_horizon: 2,
            risk_tolerance: 2,
            liquidity_needs: 2,
          },
          score: 67,
          policy_version: "risk-questionnaire-v2",
          source_event_id: "evt_risk_e2e",
          recorded_at_utc: "2026-10-14T08:00:00Z",
        },
        risk_projection_version: 1,
        forecast: {
          snapshot_id: "forecast_e2e",
          as_of_utc: "2026-10-14T08:00:00Z",
          expires_at_utc: "2026-10-16T08:00:00Z",
          horizon_days: 15,
          run_id: "run_e2e",
          model_name: "adaptive-gating",
          model_hash: "1".repeat(64),
          dataset_hash: "2".repeat(64),
          promotion_event_id: "3".repeat(64),
          scope: "research",
          forecasts: ["BTC", "ETH", "SOL"].map((asset) => ({
            asset,
            expected_return: "0.03",
            probability_up: "0.6",
            p10_return: "-0.05",
            p50_return: "0",
            p90_return: "0.1",
          })),
          price_history: priceHistory,
        },
        recommendation: {
          capital: { currency: "USD", minor_units: 270000 },
          source_kind: "finance_savings",
          savings_calculation_id: "savings_e2e",
          savings_source_event_ids: ["evt_income", "evt_expense"],
          risk_score: 50,
          risk_profile_event_id: "evt_risk_e2e",
          policy_version: "portfolio-policy-v1",
          forecast_snapshot_id: "forecast_e2e",
          promotion_event_id: "3".repeat(64),
          solver: "CLARABEL",
          fallback_used: false,
          covariance_repaired: false,
          allocations: [
            {
              asset: "BTC",
              weight: "0.50",
              amount: { currency: "USD", minor_units: 135000 },
              cap: "0.80",
            },
            {
              asset: "ETH",
              weight: "0.35",
              amount: { currency: "USD", minor_units: 94500 },
              cap: "0.60",
            },
            {
              asset: "SOL",
              weight: "0.15",
              amount: { currency: "USD", minor_units: 40500 },
              cap: "0.225",
            },
          ],
          warnings: [
            "Research output is informational and does not execute trades or transfer assets.",
          ],
        },
        default_capital: { currency: "USD", minor_units: 270000 },
        savings_formula_version: "finance-savings-v1",
        savings_calculation_id: "savings_e2e",
        savings_source_event_ids: ["evt_income", "evt_expense"],
      }),
    });
  });
  await page.route("**/api/v1/crypto/scenarios", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      amount: { currency: "USD", minor_units: 123456 },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        capital: { currency: "USD", minor_units: 123456 },
        source_kind: "scenario",
        allocations: [],
        warnings: [],
      }),
    });
  });

  await page.goto("/crypto");
  await approveWalletLogin(page);

  const capitalPanel = page.locator(".capital-card");
  const riskPanel = page.locator(".risk-questionnaire-card");
  await expect(capitalPanel).toBeVisible();
  await expect(riskPanel).toBeVisible();
  expect(
    await capitalPanel.evaluate(
      (element) => getComputedStyle(element, "::before").backgroundColor,
    ),
  ).toBe("rgb(255, 140, 160)");
  expect(
    await riskPanel.evaluate(
      (element) => getComputedStyle(element, "::before").backgroundColor,
    ),
  ).toBe("rgb(242, 189, 90)");
  await expect(capitalPanel.locator(".capital-source")).toHaveCSS(
    "color",
    "rgb(70, 214, 189)",
  );
  await expect(
    capitalPanel.getByRole("button", { name: "Edit scenario amount" }),
  ).toHaveCSS("color", "rgb(242, 189, 90)");
  await expect(riskPanel.locator(".freshness-pill")).toHaveCSS(
    "color",
    "rgb(70, 214, 189)",
  );
  expect(
    await riskPanel.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).toContain("radial-gradient");
  await page.screenshot({
    path: "test-results/crypto-panels-themed.png",
    fullPage: false,
  });

  await expect(
    page.getByRole("img", {
      name: "BTC historical USD prices with 15-day P10, P50, and P90 forecast overlays ending 29 Oct 2026",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Observed through", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("14 Oct 2026", { exact: true })).toBeVisible();
  await expect(
    page.getByText("15 calendar days", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Forecast ends", { exact: true })).toBeVisible();
  await expect(page.getByText("29 Oct 2026", { exact: true })).toBeVisible();
  await expect(page.getByText("$108.00", { exact: true })).toBeVisible();
  await expect(page.getByText("0.00%", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/P50 matches the latest observed price/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/crypto-panels-themed-mobile.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Portfolio allocation" }),
  ).toBeVisible();
  await expect(page.getByText("$1,350.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$945.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$405.00", { exact: true })).toBeVisible();
  const capitalCard = page.locator(".capital-card");
  await capitalCard
    .getByRole("button", { name: "Edit scenario amount" })
    .click();
  await expect(capitalCard).toHaveClass(/is-editing/);
  await expect(capitalCard.locator(".capital-edit-field")).toBeVisible();
  await capitalCard.getByLabel("Scenario amount (USD)").fill("1234.56");
  await capitalCard.getByRole("button", { name: "Analyze scenario" }).click();
  await expect(
    capitalCard.getByText(/Scenario active: \$1,234.56/),
  ).toBeVisible();
  await expect(
    capitalCard.getByText("Finance default unchanged.", {
      exact: false,
    }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/crypto-panels-themed-light.png",
    fullPage: false,
  });
});
