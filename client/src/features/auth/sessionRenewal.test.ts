import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_TIMER_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  SessionRenewal,
  type RenewableSession,
} from "./sessionRenewal";

const actorAddress = `0x${"a".repeat(40)}`;

function session(token: string, expiresAtMs: number): RenewableSession {
  return {
    access_token: token,
    actor_address: actorAddress,
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

describe("SessionRenewal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renews an open session before expiry and applies the rotated token", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-12T00:00:00Z");
    vi.setSystemTime(now);
    const onSession = vi.fn();
    const refresh = vi
      .fn<() => Promise<RenewableSession>>()
      .mockResolvedValue(session("rotated-token", now + 20 * 60_000));
    const renewal = new SessionRenewal({
      refresh,
      onSession,
      onFailure: vi.fn(),
    });

    renewal.start(session("initial-token", now + 10 * 60_000));
    await vi.advanceTimersByTimeAsync(9 * 60_000);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ access_token: "rotated-token" }),
    );
  });

  it("uses one refresh request when timer and visibility checks race", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-12T00:00:00Z");
    vi.setSystemTime(now);
    let resolveRefresh: ((value: RenewableSession) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<RenewableSession>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const renewal = new SessionRenewal({
      refresh,
      onSession: vi.fn(),
      onFailure: vi.fn(),
    });
    renewal.start(session("initial-token", now + 60_000));

    await vi.advanceTimersByTimeAsync(MIN_REFRESH_DELAY_MS);
    const visibilityRefresh = renewal.refreshIfNeeded();
    expect(refresh).toHaveBeenCalledTimes(1);
    resolveRefresh?.(session("rotated-token", now + 10 * 60_000));
    await visibilityRefresh;
  });

  it("ends the local session when refresh fails", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-12T00:00:00Z");
    vi.setSystemTime(now);
    const failure = new Error("refresh rejected");
    const onFailure = vi.fn();
    const renewal = new SessionRenewal({
      refresh: vi.fn().mockRejectedValue(failure),
      onSession: vi.fn(),
      onFailure,
    });
    renewal.start(session("initial-token", now + 60_000));

    await vi.advanceTimersByTimeAsync(MIN_REFRESH_DELAY_MS);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it("does not tight-loop when expiry is far beyond the setTimeout limit", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-12T00:00:00Z");
    vi.setSystemTime(now);
    const setTimer = vi.fn((callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs),
    );
    const refresh = vi.fn<() => Promise<RenewableSession>>();
    const renewal = new SessionRenewal({
      refresh,
      onSession: vi.fn(),
      onFailure: vi.fn(),
      setTimer,
    });

    renewal.start(session("long-lived-token", Date.parse("2099-01-01T00:00:00Z")));

    expect(setTimer).toHaveBeenCalledWith(
      expect.any(Function),
      MAX_TIMER_DELAY_MS,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
