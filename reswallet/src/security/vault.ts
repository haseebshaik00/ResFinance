import { base58Encode, canonicalBytes } from "./canonical";
import {
  DEFAULT_ARGON2_POLICY,
  decryptSeed,
  deriveIdentity,
  encryptSeed,
  hashParameters,
  randomBytes,
  signBytes,
  type Argon2Policy,
} from "./crypto";
import type {
  PublicIdentity,
  SignIntentRequest,
  SignedIntent,
  VaultStorage,
} from "./types";

const ALLOWED_ACTIONS = new Set([
  "auth.login",
  "split.approve",
  "credits.fund",
  "settlement.authorize",
]);

export class VaultRejected extends Error {}

export interface VaultOptions {
  allowedOrigins?: ReadonlySet<string>;
  idleTimeoutMs?: number;
  clock?: () => number;
  argon2?: Argon2Policy;
}

export class ResWallet {
  readonly #storage: VaultStorage;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #idleTimeoutMs: number;
  readonly #clock: () => number;
  readonly #argon2: Argon2Policy;
  readonly #usedNonces = new Set<string>();
  #seed: Uint8Array | null = null;
  #lastUsedAt = 0;

  constructor(storage: VaultStorage, options: VaultOptions = {}) {
    this.#storage = storage;
    this.#allowedOrigins =
      options.allowedOrigins ??
      new Set(["https://app.resfinance.local", "http://127.0.0.1:5173"]);
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000;
    this.#clock = options.clock ?? (() => Date.now());
    this.#argon2 = options.argon2 ?? DEFAULT_ARGON2_POLICY;
  }

  get unlocked(): boolean {
    this.#lockIfTimedOut();
    return this.#seed !== null;
  }

  noteTrustedActivity(): boolean {
    this.#lockIfTimedOut();
    if (this.#seed === null) return false;
    this.#lastUsedAt = this.#clock();
    return true;
  }

  async exists(): Promise<boolean> {
    return (await this.#storage.load()) !== null;
  }

  async identity(): Promise<PublicIdentity | null> {
    return (await this.#storage.load())?.public_identity ?? null;
  }

  async create(
    password: string,
    importedSeed?: Uint8Array,
  ): Promise<PublicIdentity> {
    if (await this.exists())
      throw new VaultRejected("ResWallet is already initialized");
    const seed = importedSeed?.slice() ?? randomBytes(32);
    if (seed.length !== 32)
      throw new VaultRejected("imported seed must be 32 bytes");
    try {
      const identity = await deriveIdentity(seed);
      const record = await encryptSeed(seed, password, identity, this.#argon2);
      await this.#storage.save(record);
      this.#replaceSeed(seed);
      return identity;
    } finally {
      seed.fill(0);
    }
  }

  async unlock(password: string): Promise<PublicIdentity> {
    const record = await this.#storage.load();
    if (record === null)
      throw new VaultRejected("ResWallet is not initialized");
    const seed = await decryptSeed(record, password);
    try {
      const identity = await deriveIdentity(seed);
      if (
        identity.public_key !== record.public_identity.public_key ||
        identity.address !== record.public_identity.address
      ) {
        throw new VaultRejected(
          "encrypted seed does not match public identity",
        );
      }
      this.#replaceSeed(seed);
      return identity;
    } finally {
      seed.fill(0);
    }
  }

  lock(): void {
    this.#seed?.fill(0);
    this.#seed = null;
    this.#lastUsedAt = 0;
    this.#usedNonces.clear();
  }

  async changePassword(
    currentPassword: string,
    nextPassword: string,
  ): Promise<void> {
    const record = await this.#storage.load();
    if (record === null)
      throw new VaultRejected("ResWallet is not initialized");
    const seed = await decryptSeed(record, currentPassword);
    try {
      await this.#storage.save(
        await encryptSeed(
          seed,
          nextPassword,
          record.public_identity,
          this.#argon2,
        ),
      );
      this.#replaceSeed(seed);
    } finally {
      seed.fill(0);
    }
  }

  async delete(): Promise<void> {
    this.lock();
    await this.#storage.clear();
  }

  async signIntent(
    request: SignIntentRequest,
    options: { requestingOrigin: string; approved: boolean },
  ): Promise<SignedIntent> {
    const { requestingOrigin, approved } = options;
    this.#lockIfTimedOut();
    if (this.#seed === null) throw new VaultRejected("ResWallet is locked");
    if (!approved)
      throw new VaultRejected("explicit wallet approval is required");
    if (
      !this.#allowedOrigins.has(requestingOrigin) ||
      request.origin !== requestingOrigin
    ) {
      throw new VaultRejected("requesting origin is not allowed");
    }
    if (!ALLOWED_ACTIONS.has(request.action))
      throw new VaultRejected("wallet action is not allowed");
    if (request.audience !== "resfinance-api")
      throw new VaultRejected("wallet audience is not allowed");
    if (request.network_id !== "pinned-local-network") {
      throw new VaultRejected("wallet network is not allowed");
    }
    if (
      !request.intent_id ||
      !request.resource_id ||
      request.nonce.length < 16
    ) {
      throw new VaultRejected("intent identifiers are invalid");
    }
    const issuedAt = Date.parse(request.issued_at);
    const expiresAt = Date.parse(request.expires_at);
    const now = this.#clock();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
      throw new VaultRejected("intent timestamps are invalid");
    }
    if (issuedAt > now + 30_000 || expiresAt <= now || expiresAt <= issuedAt) {
      throw new VaultRejected(
        "intent timestamps are outside the allowed window",
      );
    }
    if (expiresAt - issuedAt > 10 * 60 * 1000) {
      throw new VaultRejected("intent lifetime exceeds ten minutes");
    }
    const calculatedHash = await hashParameters(request.parameters);
    if (calculatedHash !== request.parameters_hash) {
      throw new VaultRejected("intent parameters hash mismatch");
    }
    const nonceKey = `${requestingOrigin}:${request.nonce}`;
    if (this.#usedNonces.has(nonceKey))
      throw new VaultRejected("intent nonce was already signed");

    const identity = await deriveIdentity(this.#seed);
    const unsigned = {
      version: request.version,
      intent_id: request.intent_id,
      action: request.action,
      actor_public_key: identity.public_key,
      actor_address: identity.address,
      resource_id: request.resource_id,
      parameters_hash: request.parameters_hash,
      nonce: request.nonce,
      issued_at: request.issued_at,
      expires_at: request.expires_at,
      origin: request.origin,
      audience: request.audience,
      network_id: request.network_id,
    } as const;
    const signature = base58Encode(
      signBytes(canonicalBytes(unsigned), this.#seed),
    );
    this.#usedNonces.add(nonceKey);
    this.#lastUsedAt = now;
    return { ...unsigned, signature };
  }

  #replaceSeed(seed: Uint8Array): void {
    this.#seed?.fill(0);
    this.#seed = seed.slice();
    this.#lastUsedAt = this.#clock();
    this.#usedNonces.clear();
  }

  #lockIfTimedOut(): void {
    if (
      this.#seed !== null &&
      this.#clock() - this.#lastUsedAt >= this.#idleTimeoutMs
    ) {
      this.lock();
    }
  }
}
