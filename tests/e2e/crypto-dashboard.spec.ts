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
                time_horizon: 2,
                loss_tolerance: 2,
                income_stability: 2,
                liquidity_need: 2,
                investing_experience: 2,
              },
              score: 50,
              policy_version: "risk-questionnaire-v1",
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
    page.getByRole("heading", { name: "Savings, translated into choices." }),
  ).toBeVisible();
  await expect(page.getByText("$2,700.00", { exact: true })).toBeVisible();
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
  await expect(
    page.getByText(/No forecast has passed the required quality checks/),
  ).toBeVisible();
  await expect(page.getByText(/milestone/i)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Analyze Another Amount" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save risk profile" }).click();
  await expect(page.getByText("Score 50", { exact: true })).toBeVisible();
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
            time_horizon: 2,
            loss_tolerance: 2,
            income_stability: 2,
            liquidity_need: 2,
            investing_experience: 2,
          },
          score: 50,
          policy_version: "risk-questionnaire-v1",
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
            p50_return: "0.03",
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

  await page.goto("/crypto");
  await approveWalletLogin(page);

  await expect(
    page.getByRole("img", {
      name: "BTC historical USD prices with 15-day P10, P50, and P90 forecast overlays",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portfolio allocation" }),
  ).toBeVisible();
  await expect(page.getByText("$1,350.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$945.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$405.00", { exact: true })).toBeVisible();
});
