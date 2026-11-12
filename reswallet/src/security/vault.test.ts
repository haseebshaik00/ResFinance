import { describe, expect, it } from "vitest";

import { hashParameters } from "./crypto";
import type {
  EncryptedSeedRecord,
  SignIntentRequest,
  VaultStorage,
} from "./types";
import { ResWallet } from "./vault";

const ORIGIN = "https://app.resfinance.local";
const PASSWORD = "correct horse battery staple";
const TEST_ARGON2 = { memory_kib: 32, iterations: 1, parallelism: 1 };

class MemoryStorage implements VaultStorage {
  record: EncryptedSeedRecord | null = null;

  async load(): Promise<EncryptedSeedRecord | null> {
    return this.record === null ? null : structuredClone(this.record);
  }

  async save(record: EncryptedSeedRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}

async function request(
  now: number,
  overrides: Partial<SignIntentRequest> = {},
): Promise<SignIntentRequest> {
  const parameters = overrides.parameters ?? {
    challenge: "challenge-value-000000000000000000000000",
    origin: ORIGIN,
  };
  return {
    version: 1,
    intent_id: "intent-login-0001",
    action: "auth.login",
    resource_id: "challenge-0001",
    parameters,
    parameters_hash: await hashParameters(parameters),
    nonce: "nonce-login-000000000001",
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 5 * 60 * 1000).toISOString(),
    origin: ORIGIN,
    audience: "resfinance-api",
    network_id: "pinned-local-network",
    ...overrides,
  };
}

describe("ResWallet security core", () => {
  it("matches the backend RFC 8785 and Ed25519 compatibility vector", async () => {
    const now = Date.parse("2026-10-13T18:00:00Z");
    const storage = new MemoryStorage();
    const vault = new ResWallet(storage, {
      argon2: TEST_ARGON2,
      clock: () => now,
    });
    await vault.create(
      PASSWORD,
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const parameters = {
      challenge: "challenge-value-cross-language",
      origin: ORIGIN,
    };
    const signed = await vault.signIntent(
      {
        version: 1,
        intent_id: "intent-cross-language-0001",
        action: "auth.login",
        resource_id: "challenge-cross-language-0001",
        parameters,
        parameters_hash: await hashParameters(parameters),
        nonce: "nonce-cross-language-0001",
        issued_at: "2026-10-13T18:00:00Z",
        expires_at: "2026-10-13T18:05:00Z",
        origin: ORIGIN,
        audience: "resfinance-api",
        network_id: "pinned-local-network",
      },
      { requestingOrigin: ORIGIN, approved: true },
    );

    expect(signed.signature).toBe(
      "mfiJXubbr4gpJw3UZZqjvpVDeCeiZHYU99U1JEGrAFCNyHR4K5CVSejs6j1iok9qUa8J9vRH8zsKGwnvKBHKtpb",
    );
  });

  it("persists one Argon2id/AES-GCM record without password or plaintext seed", async () => {
    const storage = new MemoryStorage();
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const vault = new ResWallet(storage, { argon2: TEST_ARGON2 });

    const identity = await vault.create(PASSWORD, seed);
    const encoded = JSON.stringify(storage.record);

    expect(identity.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(storage.record?.kdf).toMatchObject({
      algorithm: "Argon2id",
      version: 19,
      memory_kib: 32,
      iterations: 1,
    });
    expect(storage.record?.cipher.algorithm).toBe("AES-256-GCM");
    expect(encoded).not.toContain(PASSWORD);
    expect(encoded).not.toContain(Array.from(seed).join(","));
    expect(Object.keys(storage.record ?? {}).sort()).toEqual([
      "cipher",
      "kdf",
      "public_identity",
      "version",
    ]);
  });

  it("starts locked after restart and rejects signing until explicit unlock", async () => {
    const storage = new MemoryStorage();
    const first = new ResWallet(storage, { argon2: TEST_ARGON2 });
    await first.create(PASSWORD, new Uint8Array(32).fill(7));
    const restarted = new ResWallet(storage, { argon2: TEST_ARGON2 });
    const intent = await request(Date.now());

    await expect(
      restarted.signIntent(intent, {
        requestingOrigin: ORIGIN,
        approved: true,
      }),
    ).rejects.toThrow("locked");
    await expect(restarted.unlock("incorrect password value")).rejects.toThrow(
      "password or encrypted ResWallet seed is invalid",
    );
    await restarted.unlock(PASSWORD);
    await expect(
      restarted.signIntent(intent, {
        requestingOrigin: ORIGIN,
        approved: true,
      }),
    ).resolves.toMatchObject({
      action: "auth.login",
      actor_address: storage.record?.public_identity.address,
      origin: ORIGIN,
    });
  });

  it("requires approval and rejects replay, tamper, origin, network, and expiry", async () => {
    let now = Date.parse("2026-10-13T18:00:00Z");
    const storage = new MemoryStorage();
    const vault = new ResWallet(storage, {
      argon2: TEST_ARGON2,
      clock: () => now,
      idleTimeoutMs: 30 * 60 * 1000,
    });
    await vault.create(PASSWORD, new Uint8Array(32).fill(9));
    const valid = await request(now);

    await expect(
      vault.signIntent(valid, { requestingOrigin: ORIGIN, approved: false }),
    ).rejects.toThrow("approval");
    await expect(
      vault.signIntent(valid, {
        requestingOrigin: "https://evil.example",
        approved: true,
      }),
    ).rejects.toThrow("origin");
    await expect(
      vault.signIntent(
        { ...valid, network_id: "wrong-network" as "pinned-local-network" },
        { requestingOrigin: ORIGIN, approved: true },
      ),
    ).rejects.toThrow("network");
    await expect(
      vault.signIntent(
        { ...valid, parameters_hash: "0".repeat(64) },
        { requestingOrigin: ORIGIN, approved: true },
      ),
    ).rejects.toThrow("parameters hash");

    const signed = await vault.signIntent(valid, {
      requestingOrigin: ORIGIN,
      approved: true,
    });
    expect(Object.keys(signed).sort()).toEqual([
      "action",
      "actor_address",
      "actor_public_key",
      "audience",
      "expires_at",
      "intent_id",
      "issued_at",
      "network_id",
      "nonce",
      "origin",
      "parameters_hash",
      "resource_id",
      "signature",
      "version",
    ]);
    await expect(
      vault.signIntent(valid, { requestingOrigin: ORIGIN, approved: true }),
    ).rejects.toThrow("already signed");

    now += 6 * 60 * 1000;
    const expired = await request(now - 6 * 60 * 1000, {
      nonce: "nonce-login-000000000002",
    });
    await expect(
      vault.signIntent(expired, { requestingOrigin: ORIGIN, approved: true }),
    ).rejects.toThrow("timestamps");
  });

  it("automatically locks after inactivity and clears on deletion", async () => {
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const vault = new ResWallet(storage, {
      argon2: TEST_ARGON2,
      clock: () => now,
      idleTimeoutMs: 1_000,
    });
    await vault.create(PASSWORD, new Uint8Array(32).fill(5));
    expect(vault.unlocked).toBe(true);
    now += 1_000;
    expect(vault.unlocked).toBe(false);
    await vault.delete();
    expect(await vault.exists()).toBe(false);
  });

  it("stays unlocked while trusted application activity continues", async () => {
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const vault = new ResWallet(storage, {
      argon2: TEST_ARGON2,
      clock: () => now,
      idleTimeoutMs: 5 * 60 * 1000,
    });
    await vault.create(PASSWORD, new Uint8Array(32).fill(6));

    for (let minute = 0; minute < 7; minute += 1) {
      now += 60 * 1000;
      expect(vault.noteTrustedActivity()).toBe(true);
      expect(vault.unlocked).toBe(true);
    }

    now += 5 * 60 * 1000;
    expect(vault.unlocked).toBe(false);
    expect(vault.noteTrustedActivity()).toBe(false);
  });
});
