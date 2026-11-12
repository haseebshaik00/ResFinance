export interface TrustedActivityEvent {
  readonly isTrusted: boolean;
}

export class TrustedActivityReporter {
  readonly #report: () => void;
  readonly #clock: () => number;
  readonly #minimumIntervalMs: number;
  #lastReportedAt: number | null = null;

  constructor(
    report: () => void,
    options: { clock?: () => number; minimumIntervalMs?: number } = {},
  ) {
    this.#report = report;
    this.#clock = options.clock ?? (() => Date.now());
    this.#minimumIntervalMs = options.minimumIntervalMs ?? 15_000;
  }

  observe(event: TrustedActivityEvent, pageVisible: boolean): boolean {
    if (!event.isTrusted || !pageVisible) return false;
    const now = this.#clock();
    if (
      this.#lastReportedAt !== null &&
      now - this.#lastReportedAt < this.#minimumIntervalMs
    ) {
      return false;
    }
    this.#lastReportedAt = now;
    this.#report();
    return true;
  }
}
