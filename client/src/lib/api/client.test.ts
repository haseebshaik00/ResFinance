import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deactivateFinanceBudget,
  deactivateFinanceRecurringEntry,
  queryInsights,
  refreshSession,
  voidFinanceTransaction,
} from "./client";

describe("refreshSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rotates the session through the HttpOnly refresh cookie boundary", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "rotated-token",
          token_type: "Bearer",
          expires_at: "2026-11-12T00:10:00Z",
          actor_address: `0x${"a".repeat(40)}`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(refreshSession()).resolves.toMatchObject({
      access_token: "rotated-token",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

describe("queryInsights", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops a stalled evidence request with a useful error", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const request = expect(
      queryInsights("access-token", {
        month: "2026-10",
        question: "How can I improve my savings?",
      }),
    ).rejects.toThrow("The evidence check took too long. Please try again.");

    await vi.advanceTimersByTimeAsync(30_000);
    await request;
  });
});

describe("finance correction commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correction events through the generated API boundary", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            event_id: "event-1",
            projection_version: 9,
            occurred_at_utc: "2026-10-19T20:00:00Z",
            deduplicated: false,
            receipt_ids: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );

    await voidFinanceTransaction(
      "access-token",
      "rent duplicate",
      "void-command-1",
      { reason: "Duplicate transaction", expected_version: 8 },
    );
    await deactivateFinanceRecurringEntry(
      "access-token",
      "monthly rent",
      "deactivate-command-1",
      { expected_version: 9 },
    );
    await deactivateFinanceBudget(
      "access-token",
      "rent 2026-10",
      "remove-budget-command-1",
      { expected_version: 10 },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/finance/transactions/rent%20duplicate/void",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "Duplicate transaction",
          expected_version: 8,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/finance/recurring/monthly%20rent/deactivate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_version: 9 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/finance/budgets/rent%202026-10/deactivate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_version: 10 }),
      }),
    );
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    expect(firstRequest?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Idempotency-Key": "void-command-1",
    });
  });
});
