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
    p10_prices: ["67600", "67650", "67700", "67750", "67800", "67850", "67900"],
    p50_prices: ["68100", "68200", "68300", "68400", "68500", "68600", "68700"],
    p90_prices: ["68600", "68750", "68900", "69050", "69200", "69350", "69500"],
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
    p10_prices: ["1885", "1888", "1891", "1894", "1897", "1900", "1905"],
    p50_prices: ["1905", "1910", "1915", "1920", "1925", "1930", "1938"],
    p90_prices: ["1925", "1932", "1939", "1946", "1953", "1960", "1971"],
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
    p10_prices: ["77.4", "77.6", "77.8", "78", "78.2", "78.4", "78.7"],
    p50_prices: ["78.2", "78.4", "78.6", "78.8", "79", "79.2", "79.56"],
    p90_prices: ["79", "79.2", "79.4", "79.6", "79.8", "80", "80.42"],
  },
];

let forecastStatus: "current" | "stale" = "current";
let staleReasons: string[] = [];

test.beforeEach(async ({ page }) => {
  forecastStatus = "current";
  staleReasons = [];
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
  await page.route("**/api/v1/finance/overview?month=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          savings: {
            available: { currency: "USD", minor_units: 100000 },
          },
        },
      }),
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
        status: forecastStatus,
        stale_reasons: staleReasons,
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
  await page.route("**/api/v1/crypto/risk-profile", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          event_id: "evt-risk-profile-e2e",
          projection_version: 1,
          occurred_at_utc: "2026-11-14T06:30:00Z",
          deduplicated: false,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        projection_version: 1,
        profile: {
          answers: {
            investment_horizon: 2,
            risk_tolerance: 2,
            liquidity_needs: 1,
          },
          score: 78,
          policy_version: "risk-questionnaire-v3",
          source_event_id: "evt-risk-profile-e2e",
          recorded_at_utc: "2026-11-14T06:30:00Z",
        },
      }),
    });
  });
  await page.route("**/api/v1/crypto/recommendations", async (route) => {
    const capital = route.request().postDataJSON().capital
      .minor_units as number;
    const weights = [0.25, 0.4, 0.15];
    const cashWeight = 0.2;
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
        policy_version: "phase2-risk-profile-model-blend-v4",
        risk_profile: "growth",
        risk_score: 78,
        risk_profile_event_id: "evt-risk-profile-e2e",
        risk_policy_version: "risk-questionnaire-v3",
        model_confidence: "0.20",
        model_blend: "confidence-weighted",
        strategic_allocations: ["BTC", "ETH", "SOL"].map((asset, index) => ({
          asset,
          weight: weights[index].toString(),
          amount: { currency: "USD", minor_units: amounts[index] },
        })),
        strategic_cash_reserve: {
          label: "USD cash reserve",
          weight: cashWeight.toString(),
          amount: { currency: "USD", minor_units: cashAmount },
        },
        tactical_adjustments: ["BTC", "ETH", "SOL"].map((asset) => ({
          asset,
          weight: "0",
        })),
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
  await expect(page.getByText("Savings month", { exact: true })).toBeVisible();
  const forecastStatusBox = await page
    .locator(".crypto-header-actions .forecast-status")
    .boundingBox();
  const savingsMonthBox = await page
    .locator(".crypto-header-actions .month-control")
    .boundingBox();
  expect(forecastStatusBox).not.toBeNull();
  expect(savingsMonthBox).not.toBeNull();
  expect(savingsMonthBox!.y).toBeGreaterThan(forecastStatusBox!.y);
  expect(
    Math.abs(
      forecastStatusBox!.x +
        forecastStatusBox!.width -
        (savingsMonthBox!.x + savingsMonthBox!.width),
    ),
  ).toBeLessThan(2);
  const cryptoHeroBox = await page
    .locator(".phase2-dashboard .dashboard-header > div")
    .first()
    .boundingBox();
  expect(cryptoHeroBox).not.toBeNull();
  const monthBottomOffset =
    cryptoHeroBox!.y +
    cryptoHeroBox!.height -
    (savingsMonthBox!.y + savingsMonthBox!.height);
  expect(monthBottomOffset).toBeGreaterThanOrEqual(8);
  expect(monthBottomOffset).toBeLessThan(16);
  const forecastStatusTrigger = page.getByRole("button", {
    name: "Current forecast details",
  });
  await forecastStatusTrigger.hover();
  const forecastStatusTooltip = page.locator(".forecast-status-tooltip");
  await expect(forecastStatusTooltip).toBeVisible();
  const tooltipIsTopmostAtBottom = await forecastStatusTooltip.evaluate(
    (tooltip) => {
      const { left, top, width, height } = tooltip.getBoundingClientRect();
      tooltip.style.pointerEvents = "auto";
      const isTopmost =
        document
          .elementFromPoint(left + width / 2, top + height - 8)
          ?.closest(".forecast-status-tooltip") === tooltip;
      tooltip.style.pointerEvents = "";
      return isTopmost;
    },
  );
  expect(tooltipIsTopmostAtBottom).toBe(true);
  const savingsMonthTrigger = page.locator(
    ".crypto-header-actions .reporting-month-trigger",
  );
  await savingsMonthTrigger.click();
  const savingsMonthMenu = page.locator(
    ".crypto-header-actions .reporting-month-menu",
  );
  await expect(savingsMonthMenu).toBeVisible();
  await expect(page.locator(".crypto-header-actions")).toHaveCSS(
    "z-index",
    "1",
  );
  const menuIsTopmostAtCenter = await savingsMonthMenu.evaluate((menu) => {
    const { left, top, width, height } = menu.getBoundingClientRect();
    return (
      document
        .elementFromPoint(left + width / 2, top + height / 2)
        ?.closest(".reporting-month-menu") === menu
    );
  });
  expect(menuIsTopmostAtCenter).toBe(true);
  await savingsMonthTrigger.press("Escape");
  await expect(savingsMonthMenu).toBeHidden();
  await expect(
    page.locator(".phase2-portfolio .portfolio-setup-row .capital-card"),
  ).toContainText("Investment Capital");
  await expect(
    page.locator(
      ".phase2-portfolio .portfolio-setup-row > .capital-card, .phase2-portfolio .portfolio-setup-row > .risk-questionnaire-card",
    ),
  ).toHaveCount(2);
  const setupCardWidths = await page
    .locator(
      ".phase2-portfolio .portfolio-setup-row > .capital-card, .phase2-portfolio .portfolio-setup-row > .risk-questionnaire-card",
    )
    .evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().width),
    );
  expect(Math.abs(setupCardWidths[0]! - setupCardWidths[1]!)).toBeLessThan(2);
  const riskScore = page.getByRole("button", {
    name: "Risk score 78 details",
  });
  const portfolioActions = page.locator(
    ".portfolio-heading-actions > .methodology-info, .portfolio-heading-actions > a, .portfolio-heading-actions > .risk-score",
  );
  await expect(portfolioActions).toHaveCount(3);
  const portfolioActionBounds = await portfolioActions.evaluateAll((actions) =>
    actions.map((action) => action.getBoundingClientRect()),
  );
  expect(
    portfolioActionBounds.every(
      (action) =>
        Math.abs(action.height - portfolioActionBounds[0]!.height) < 1,
    ),
  ).toBe(true);
  expect(
    portfolioActionBounds.every(
      (action) => Math.abs(action.top - portfolioActionBounds[0]!.top) < 1,
    ),
  ).toBe(true);
  await riskScore.hover();
  await expect(page.locator(".risk-score-tooltip")).toContainText(
    "[Profile version 1]",
  );
  await expect(page.locator(".risk-score-tooltip")).toContainText(
    "Your answers set the BTC, ETH, SOL, and cash targets.",
  );
  await expect(page.locator(".risk-score-tooltip")).toContainText(
    "The forecast can refine only the crypto sleeve.",
  );
  await expect(page.locator(".risk-score-tooltip")).toContainText(
    "The responses are wallet-scoped and informational only.",
  );
  const forecastStatusButton = page.getByRole("button", {
    name: "Current forecast details",
  });
  await forecastStatusButton.hover();
  await expect(page.locator(".forecast-status-tooltip")).toContainText(
    "Generated 14 Nov 2026, 06:30 UTC",
  );
  await expect(page.locator(".forecast-status-tooltip")).toContainText(
    "Market cutoff 13 Nov 2026",
  );
  await expect(
    page.getByRole("heading", {
      name: "Crypto Market Overview",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".phase2-market-layout")).toHaveCount(1);
  await expect(page.locator(".phase2-market-section")).toHaveCount(1);
  await expect(
    page.locator(".phase2-market-layout > .phase2-market-section"),
  ).toHaveCount(1);
  await expect(page.locator(".phase2-market-section")).toHaveAttribute(
    "data-animated",
    "true",
  );
  await expect(page.locator(".phase2-market-card")).toHaveCount(3);
  await expect(
    page.locator(".phase2-market-section + .phase2-outlook"),
  ).toHaveCount(1);
  await expect(page.getByText("$68,700.00", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /BTC observed price.*Historical Error Range summarizes held-out error.*not a validated 80% prediction interval/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Historical Error Range", { exact: true }),
  ).toBeVisible();
  const provenancePanel = page.locator(".crypto-provenance-panel");
  await expect(provenancePanel).not.toHaveAttribute("open");
  await expect(
    page.locator(".phase2-portfolio + .crypto-provenance-panel"),
  ).toHaveCount(1);
  await expect(
    page.getByText("Historical Model Accuracy", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Forecast Provenance", { exact: true }),
  ).not.toBeVisible();
  await provenancePanel.locator("summary").click();
  await expect(
    page.getByText("Historical Model Accuracy", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast Provenance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portfolio Allocation" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Explore risk-aware 7-day portfolio recommendations across BTC, ETH, SOL, and USD cash.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "How to use the Crypto Intelligence dashboard",
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Crypto Intelligence guide",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Recommendations are informational only",
  );
  await page.getByRole("button", { name: "Close dashboard guide" }).click();
  await expect(
    page.locator(".portfolio-section-heading + .phase2-portfolio"),
  ).toHaveCount(1);
  await expect(page.getByLabel("Investment Capital (USD)")).toHaveValue(
    "1000.00",
  );
  await expect(
    page.getByText(
      /Default Investment Capital: \$1,000\.00 for .*Alternate amounts are read-only/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze scenario" }),
  ).toBeVisible();
  await expect(
    page.locator(".capital-source", { hasText: "Available savings" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Default scenario: Using available savings/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit scenario amount" }),
  ).toHaveCount(0);
  await expect(page.getByText("$250.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$400.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$150.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$200.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("USD cash reserve", { exact: true }),
  ).toBeVisible();
  const methodologyButton = page.getByRole("button", {
    name: "How recommendations are calculated",
  });
  await methodologyButton.hover();
  await expect(page.locator(".methodology-info-tooltip")).toContainText(
    "Model confidence: 20.00%; strategic targets are blended with the forecast/covariance model mix.",
  );
  await expect(
    page
      .locator(".phase2-portfolio .portfolio-setup-row")
      .getByText("Risk Questionnaire"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "How long can this hypothetical allocation remain invested?",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("Growth Profile · Risk Score 78 · Cash 20.00%"),
  ).toBeVisible();
  const savingsAllocationHeading = page.getByRole("heading", {
    name: "Savings Allocation",
  });
  await expect(savingsAllocationHeading).toBeVisible();
  const allocationProfile = page.getByText(
    "Growth Profile · Risk Score 78 · Cash 20.00%",
  );
  const [savingsAllocationBox, allocationProfileBox] = await Promise.all([
    savingsAllocationHeading.boundingBox(),
    allocationProfile.boundingBox(),
  ]);
  expect(savingsAllocationBox).not.toBeNull();
  expect(allocationProfileBox).not.toBeNull();
  expect(savingsAllocationBox!.x).toBeLessThan(allocationProfileBox!.x);
  await expect(page.locator(".allocation-donut-center-label")).toContainText(
    "SavingsAllocation",
  );
  const firstAllocationSliceGroup = page
    .locator(".allocation-donut-chart .recharts-pie-sector")
    .first();
  const firstAllocationSlice = firstAllocationSliceGroup.locator("path");
  const idleSlicePath = await firstAllocationSlice.getAttribute("d");
  await firstAllocationSliceGroup.hover();
  await expect(firstAllocationSlice).toHaveClass(/is-active/);
  await expect
    .poll(() => firstAllocationSlice.getAttribute("d"))
    .not.toBe(idleSlicePath);
  await expect(page.getByText(/15-day/i)).toHaveCount(0);

  await page.getByLabel("Investment Capital (USD)").fill("2000.00");
  await page.getByRole("button", { name: "Analyze scenario" }).click();
  await expect(page.getByText("$500.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$800.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$300.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$400.00", { exact: true })).toBeVisible();
  await expect(page.getByText(/Scenario active: \$2000\.00/)).toBeVisible();
  await expect(
    page.locator(".capital-source.is-scenario-active", {
      hasText: "Scenario active",
    }),
  ).toBeVisible();

  const solAllocationSliceGroup = page
    .locator(".allocation-donut-chart .recharts-pie-sector")
    .nth(2);
  await solAllocationSliceGroup.hover();
  const activeAllocationLabel = page.locator(
    ".allocation-donut-label.is-active",
  );
  await expect(activeAllocationLabel).toContainText("SOL");
  await expect(activeAllocationLabel).toContainText("15.00% · $300.00");
  await expect(
    page.locator(".allocation-donut-active-label-card"),
  ).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(
    await page
      .locator(".portfolio-section-heading")
      .evaluate((heading) =>
        Array.from(heading.children).every(
          (child) => child.scrollWidth <= child.clientWidth,
        ),
      ),
  ).toBe(true);
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: "test-results/crypto-phase2-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".forecast-line")).toBeVisible();
  await expect(page.locator(".forecast-uncertainty-band")).toBeVisible();
  await expect(page.locator(".phase2-chart")).toHaveAttribute(
    "data-animated",
    "true",
  );
  await forecastStatusButton.hover();
  await expect(page.locator(".forecast-status-tooltip")).toBeVisible();
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

test("keeps historical model provenance collapsed until requested", async ({
  page,
}) => {
  await page.goto("/crypto");
  await approveWalletLogin(page);

  const provenancePanel = page.locator(".crypto-provenance-panel");
  await expect(provenancePanel).not.toHaveAttribute("open");
  await expect(
    page.getByText("Historical Model Accuracy", { exact: true }),
  ).not.toBeVisible();

  await provenancePanel.locator("summary").click();

  await expect(provenancePanel).toHaveAttribute("open", "");
  await expect(
    page.getByText("Historical Model Accuracy", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast Provenance", { exact: true }),
  ).toBeVisible();
});

test("shows stale reasons in the forecast status hover", async ({ page }) => {
  forecastStatus = "stale";
  staleReasons = [
    "Market data is one day behind the latest completed UTC day.",
  ];

  await page.goto("/crypto");
  await approveWalletLogin(page);

  const forecastStatusButton = page.getByRole("button", {
    name: "Stale forecast details",
  });
  await forecastStatusButton.hover();
  const tooltip = page.locator(".forecast-status-tooltip");
  await expect(tooltip).toContainText("Forecast freshness warning");
  await expect(tooltip).toContainText(staleReasons[0]!);
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
