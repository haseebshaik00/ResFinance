export interface RenewableSession {
  access_token: string;
  actor_address: string;
  expires_at: string;
}

interface SessionRenewalOptions {
  refresh(): Promise<RenewableSession>;
  onSession(session: RenewableSession): void;
  onFailure(error: unknown): void;
  clock?: () => number;
  refreshLeadMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (timerId: number) => void;
}

export class SessionRenewal {
  readonly #options: Required<
    Pick<
      SessionRenewalOptions,
      "clock" | "refreshLeadMs" | "setTimer" | "clearTimer"
    >
  > &
    Omit<
      SessionRenewalOptions,
      "clock" | "refreshLeadMs" | "setTimer" | "clearTimer"
    >;
  #current: RenewableSession | null = null;
  #timerId: number | null = null;
  #refreshing: Promise<void> | null = null;
  #generation = 0;

  constructor(options: SessionRenewalOptions) {
    this.#options = {
      ...options,
      clock: options.clock ?? (() => Date.now()),
      refreshLeadMs: options.refreshLeadMs ?? 60_000,
      setTimer:
        options.setTimer ??
        ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
      clearTimer:
        options.clearTimer ?? ((timerId) => globalThis.clearTimeout(timerId)),
    };
  }

  start(session: RenewableSession): void {
    this.#generation += 1;
    this.#clearScheduledRefresh();
    this.#current = session;
    this.#options.onSession(session);
    this.#schedule(this.#generation);
  }

  stop(): void {
    this.#generation += 1;
    this.#clearScheduledRefresh();
    this.#current = null;
    this.#refreshing = null;
  }

  refreshIfNeeded(): Promise<void> {
    if (this.#current === null) return Promise.resolve();
    const expiresAt = Date.parse(this.#current.expires_at);
    if (
      Number.isFinite(expiresAt) &&
      expiresAt - this.#options.clock() > this.#options.refreshLeadMs
    ) {
      return Promise.resolve();
    }
    return this.#refresh(this.#generation);
  }

  #schedule(generation: number): void {
    if (this.#current === null) return;
    const expiresAt = Date.parse(this.#current.expires_at);
    const delayMs = Number.isFinite(expiresAt)
      ? Math.max(
          0,
          expiresAt - this.#options.clock() - this.#options.refreshLeadMs,
        )
      : 0;
    this.#timerId = this.#options.setTimer(() => {
      this.#timerId = null;
      void this.#refresh(generation).catch(() => undefined);
    }, delayMs);
  }

  #refresh(generation: number): Promise<void> {
    if (generation !== this.#generation || this.#current === null) {
      return Promise.resolve();
    }
    if (this.#refreshing !== null) return this.#refreshing;

    const refreshing = this.#options
      .refresh()
      .then((session) => {
        if (generation !== this.#generation) return;
        this.#clearScheduledRefresh();
        this.#current = session;
        this.#options.onSession(session);
        this.#schedule(generation);
      })
      .catch((error: unknown) => {
        if (generation === this.#generation) {
          this.#generation += 1;
          this.#clearScheduledRefresh();
          this.#current = null;
          this.#options.onFailure(error);
        }
        throw error;
      })
      .finally(() => {
        if (this.#refreshing === refreshing) this.#refreshing = null;
      });
    this.#refreshing = refreshing;
    return refreshing;
  }

  #clearScheduledRefresh(): void {
    if (this.#timerId === null) return;
    this.#options.clearTimer(this.#timerId);
    this.#timerId = null;
  }
}
