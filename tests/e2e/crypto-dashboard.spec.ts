import { expect, test } from "@playwright/test";

import { approveWalletLogin, prepareWalletLogin } from "./wallet-login";

const assets = [
  {
    asset: "BTC",
    current_price: "68000.00",
    predicted_prices: [
      "68100",
      "68200",
      "68300",
      "68400",
      "68500",
      "68600",
      "68700",
    ],
    predicted_daily_returns: [
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
    ],
    predicted_return_7d: "0.0102941176",
  },
  {
    asset: "ETH",
    current_price: "1900.00",
    predicted_prices: ["1905", "1910", "1915", "1920", "1925", "1930", "1938"],
    predicted_daily_returns: [
      "0.002",
      "0.002",
      "0.002",
      "0.002",
      "0.002",
      "0.002",
      "0.004",
    ],
    predicted_return_7d: "0.02",
  },
  {
    asset: "SOL",
    current_price: "78.00",
    predicted_prices: ["78.2", "78.4", "78.6", "78.8", "79", "79.2", "79.56"],
    predicted_daily_returns: [
      "0.002",
      "0.002",
      "0.002",
      "0.002",
      "0.002",
      "0.002",
      "0.004",
    ],
    predicted_return_7d: "0.02",
  },
];

test.beforeEach(async ({ page }) => {
  await prepareWalletLogin(page);
  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "e2e-access-token",
        token_type: "Bearer",
        expires_at: "2026-11-14T08:10:00Z",
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
  await page.route("**/api/v1/crypto/forecast", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        snapshot_id: "forecast-phase2-e2e",
        run_id: "phase1-vasa-v2-e2e",
        manifest_key: "phase1-run:phase1-vasa-v2-e2e:manifest",
        model_key: "original-mspciformer",
        model_name: "Original MSPCIFormer reimplementation",
        model_version: "phase1-market-only-v2",
        generated_at_utc: "2026-11-14T06:30:00Z",
        market_data_cutoff_utc: "2026-11-13T00:00:00Z",
        forecast_dates_utc: [
          "2026-11-14",
          "2026-11-15",
          "2026-11-16",
          "2026-11-17",
          "2026-11-18",
          "2026-11-19",
          "2026-11-20",
        ],
        assets,
        status: "current",
        stale_reasons: [],
        refreshed_from_checkpoint: false,
        quality_checks: {
          finite: true,
          positive_prices: true,
          fallback_used: false,
        },
        accuracy: ["original-mspciformer", "vasa-mspciformer"].map(
          (model_key) => ({
            model_key,
            mape: model_key === "original-mspciformer" ? "0.044" : "0.045",
            return_7d_mae: "0.058",
            directional_accuracy: "0.50",
            btc_day_7_mae_usd: "3582",
            eth_day_7_mae_usd: "174",
            sol_day_7_mae_usd: "9",
          }),
        ),
        research_status: "experimental",
      }),
    });
  });
  await page.route("**/api/v1/crypto/recommendations", async (route) => {
    const capital = route.request().postDataJSON().capital
      .minor_units as number;
    const weights = [0.24, 0.21, 0.15];
    const cashWeight = 0.4;
    const amounts = [
      Math.round(capital * weights[0]),
      Math.round(capital * weights[1]),
    ];
    amounts.push(Math.round(capital * weights[2]));
    const cashAmount = capital - amounts[0] - amounts[1] - amounts[2];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        capital: { currency: "USD", minor_units: capital },
        forecast_snapshot_id: "forecast-phase2-e2e",
        forecast_status: "current",
        model_key: "original-mspciformer",
        model_version: "phase1-market-only-v2",
        expected_returns_7d: assets.map((item) => ({
          asset: item.asset,
          predicted_return_7d: item.predicted_return_7d,
        })),
        predicted_portfolio_return_7d: "0.0161",
        estimated_portfolio_volatility_7d: "0.045",
        risk_aversion: "5.0",
        covariance_lookback_days: 365,
        covariance_estimator: "Ledoit-Wolf",
        covariance_repaired: false,
        solver: "CLARABEL",
        solver_status: "optimal",
        policy_version: "phase2-mean-variance-cash-v2",
        allocations: ["BTC", "ETH", "SOL"].map((asset, index) => ({
          asset,
          weight: weights[index].toString(),
          amount: { currency: "USD", minor_units: amounts[index] },
        })),
        cash_reserve: {
          label: "USD cash reserve",
          weight: cashWeight.toString(),
          amount: { currency: "USD", minor_units: cashAmount },
        },
        crypto_allocation_weight: "0.6",
        total_allocation_weight: "1.0",
        warnings: [
          "Experimental research output: predicted returns are uncertain.",
        ],
      }),
    });
  });
});

test("renders the seven-day forecast and updates optimizer amounts", async ({
  page,
}) => {
  await page.goto("/crypto");
  await approveWalletLogin(page);

  await expect(
    page.getByRole("heading", { name: "Crypto Intelligence" }),
  ).toBeVisible();
  await expect(
    page.getByText("Current forecast", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Crypto Market Overview" }),
  ).toBeVisible();
  await expect(page.getByText("$68,700.00", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /BTC observed price.*seven predicted daily USD prices/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portfolio Allocation" }),
  ).toBeVisible();
  await expect(page.getByText("$240.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$210.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$150.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$400.00", { exact: true })).toBeVisible();
  await expect(page.getByText("USD cash reserve", { exact: true })).toBeVisible();
  await expect(page.getByText("Risk Questionnaire")).toHaveCount(0);
  await expect(page.getByText(/15-day/i)).toHaveCount(0);

  await page.getByLabel("Investment Capital (USD)").fill("2000.00");
  await expect(page.getByText("$480.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$420.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$300.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$800.00", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(
    await page.locator(".phase2-portfolio .section-heading").evaluate(
      (heading) =>
        Array.from(heading.children).every(
          (child) => child.scrollWidth <= child.clientWidth,
        ),
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/crypto-phase2-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".forecast-line")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/crypto-phase2-mobile.png",
    fullPage: true,
  });
});

test("shows a meaningful forecast failure", async ({ page }) => {
  await page.route("**/api/v1/crypto/forecast", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        detail: "seven-day forecast is unavailable: verified artifact missing",
      }),
    });
  });
  await page.goto("/crypto");
  await approveWalletLogin(page);
  await expect(
    page.getByRole("heading", { name: "Crypto Intelligence is unavailable." }),
  ).toBeVisible();
  await expect(page.getByText(/verified artifact missing/)).toBeVisible();
});
