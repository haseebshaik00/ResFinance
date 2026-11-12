import { ResWallet } from "./security/vault";
import type { SignIntentRequest } from "./security/types";
import { ChromeVaultStorage } from "./storage";

const vault = new ResWallet(new ChromeVaultStorage());
const pending = new Map<
  string,
  { request: SignIntentRequest; origin: string; port: chrome.runtime.Port }
>();
const connectedPorts = new Set<chrome.runtime.Port>();

chrome.runtime.onSuspend.addListener(() => {
  vault.lock();
  void broadcastVaultStatus();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reswallet-auto-lock") {
    vault.lock();
    void broadcastVaultStatus();
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "resfinance-page") return;
  const origin = tabOrigin(port.sender?.tab?.url);
  if (origin === null) {
    port.disconnect();
    return;
  }
  connectedPorts.add(port);
  void postVaultStatus(port);
  port.onMessage.addListener((message: unknown) => {
    void handlePageMessage(port, origin, message);
  });
  port.onDisconnect.addListener(() => {
    connectedPorts.delete(port);
    for (const [requestId, request] of pending) {
      if (request.port === port) pending.delete(requestId);
    }
  });
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    // Trust only packaged extension pages. Content scripts share the extension
    // ID but retain the web page URL, including when an extension page is
    // opened in a normal tab by the browser acceptance harness.
    const extensionRoot = chrome.runtime.getURL("");
    if (
      sender.id !== chrome.runtime.id ||
      typeof sender.url !== "string" ||
      !sender.url.startsWith(extensionRoot)
    )
      return false;
    void handleExtensionMessage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: safeError(error) }),
      );
    return true;
  },
);

async function handlePageMessage(
  port: chrome.runtime.Port,
  origin: string,
  message: unknown,
): Promise<void> {
  if (
    isObject(message) &&
    message.source === "reswallet-content" &&
    message.version === 1 &&
    message.type === "USER_ACTIVITY"
  ) {
    if (vault.noteTrustedActivity()) await scheduleAutoLock();
    return;
  }
  if (
    !isObject(message) ||
    message.source !== "resfinance-page" ||
    message.version !== 1
  ) {
    return;
  }
  const requestId =
    typeof message.request_id === "string" ? message.request_id : "";
  try {
    if (message.type === "GET_IDENTITY") {
      const identity = await vault.identity();
      port.postMessage({
        source: "reswallet",
        version: 1,
        request_id: requestId,
        ok: true,
        result: identity,
      });
      return;
    }
    if (message.type === "GET_STATUS") {
      port.postMessage({
        source: "reswallet",
        version: 1,
        request_id: requestId,
        ok: true,
        result: await walletStatus(),
      });
      return;
    }
    if (message.type === "LOCK") {
      vault.lock();
      await chrome.alarms.clear("reswallet-auto-lock");
      port.postMessage({
        source: "reswallet",
        version: 1,
        request_id: requestId,
        ok: true,
        result: { locked: true },
      });
      await broadcastVaultStatus();
      return;
    }
    if (
      message.type !== "SIGN_INTENT" ||
      !isSignIntentRequest(message.intent)
    ) {
      throw new Error("ResWallet request is not supported");
    }
    if (!vault.unlocked) throw new Error("ResWallet is locked");
    if (pending.has(requestId))
      throw new Error("ResWallet request ID is already pending");
    pending.set(requestId, { request: message.intent, origin, port });
    try {
      await openApprovalPopup(requestId, port.sender?.tab);
    } catch (error) {
      pending.delete(requestId);
      throw error;
    }
  } catch (error) {
    port.postMessage({
      source: "reswallet",
      version: 1,
      request_id: requestId,
      ok: false,
      error: safeError(error),
    });
  }
}

async function handleExtensionMessage(message: unknown): Promise<unknown> {
  if (!isObject(message) || typeof message.type !== "string") {
    throw new Error("ResWallet extension request is invalid");
  }
  switch (message.type) {
    case "GET_STATUS":
      return walletStatus();
    case "CREATE": {
      if (typeof message.password !== "string")
        throw new Error("password is required");
      const identity = await vault.create(message.password);
      await scheduleAutoLock();
      await broadcastVaultStatus();
      return identity;
    }
    case "IMPORT": {
      if (
        typeof message.password !== "string" ||
        typeof message.seed_hex !== "string"
      ) {
        throw new Error("password and seed are required");
      }
      const identity = await vault.create(
        message.password,
        hexToBytes(message.seed_hex),
      );
      await scheduleAutoLock();
      await broadcastVaultStatus();
      return identity;
    }
    case "UNLOCK": {
      if (typeof message.password !== "string")
        throw new Error("password is required");
      const identity = await vault.unlock(message.password);
      await scheduleAutoLock();
      await broadcastVaultStatus();
      return identity;
    }
    case "LOCK":
      vault.lock();
      await chrome.alarms.clear("reswallet-auto-lock");
      await broadcastVaultStatus();
      return { locked: true };
    case "DELETE":
      await vault.delete();
      await chrome.alarms.clear("reswallet-auto-lock");
      await broadcastVaultStatus();
      return { deleted: true };
    case "APPROVAL_DETAILS": {
      if (typeof message.request_id !== "string")
        throw new Error("request ID is required");
      const item = pending.get(message.request_id);
      if (item === undefined)
        throw new Error("approval request is no longer available");
      return {
        request_id: message.request_id,
        origin: item.origin,
        action: item.request.action,
        resource_id: item.request.resource_id,
        parameters: item.request.parameters,
        network_id: item.request.network_id,
        expires_at: item.request.expires_at,
      };
    }
    case "APPROVAL_DECISION": {
      if (
        typeof message.request_id !== "string" ||
        typeof message.approved !== "boolean"
      ) {
        throw new Error("approval decision is invalid");
      }
      const item = pending.get(message.request_id);
      if (item === undefined)
        throw new Error("approval request is no longer available");
      if (!message.approved) {
        pending.delete(message.request_id);
        item.port.postMessage({
          source: "reswallet",
          version: 1,
          request_id: message.request_id,
          ok: false,
          error: "The signing request was rejected in ResWallet.",
        });
        return { approved: false };
      }
      try {
        const signed = await vault.signIntent(item.request, {
          requestingOrigin: item.origin,
          approved: true,
        });
        await scheduleAutoLock();
        item.port.postMessage({
          source: "reswallet",
          version: 1,
          request_id: message.request_id,
          ok: true,
          result: signed,
        });
      } catch (error) {
        item.port.postMessage({
          source: "reswallet",
          version: 1,
          request_id: message.request_id,
          ok: false,
          error: safeError(error),
        });
        throw error;
      } finally {
        pending.delete(message.request_id);
      }
      return { approved: true };
    }
    default:
      throw new Error("ResWallet extension request is not supported");
  }
}

async function openApprovalPopup(
  requestId: string,
  sourceTab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (sourceTab?.id === undefined || sourceTab.windowId === undefined) {
    throw new Error("The ResFinance browser tab is unavailable");
  }
  await chrome.action.setPopup({
    tabId: sourceTab.id,
    popup: `approval.html?request=${encodeURIComponent(requestId)}`,
  });
  try {
    await chrome.action.openPopup({ windowId: sourceTab.windowId });
  } finally {
    await chrome.action.setPopup({
      tabId: sourceTab.id,
      popup: "popup.html",
    });
  }
}

async function walletStatus(): Promise<{
  exists: boolean;
  unlocked: boolean;
  identity: Awaited<ReturnType<ResWallet["identity"]>>;
}> {
  return {
    exists: await vault.exists(),
    unlocked: vault.unlocked,
    identity: await vault.identity(),
  };
}

async function postVaultStatus(port: chrome.runtime.Port): Promise<void> {
  try {
    port.postMessage({
      source: "reswallet",
      version: 1,
      type: "STATUS_CHANGED",
      status: await walletStatus(),
    });
  } catch {
    connectedPorts.delete(port);
  }
}

async function broadcastVaultStatus(): Promise<void> {
  await Promise.all([...connectedPorts].map((port) => postVaultStatus(port)));
}

async function scheduleAutoLock(): Promise<void> {
  await chrome.alarms.create("reswallet-auto-lock", { delayInMinutes: 5 });
}

function tabOrigin(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "https://app.resfinance.local" ||
      origin === "http://127.0.0.1:5173"
      ? origin
      : null;
  } catch {
    return null;
  }
}

function isSignIntentRequest(value: unknown): value is SignIntentRequest {
  return (
    isObject(value) &&
    value.version === 1 &&
    typeof value.intent_id === "string" &&
    typeof value.action === "string" &&
    typeof value.resource_id === "string" &&
    isObject(value.parameters) &&
    typeof value.parameters_hash === "string" &&
    typeof value.nonce === "string" &&
    typeof value.issued_at === "string" &&
    typeof value.expires_at === "string" &&
    typeof value.origin === "string" &&
    value.audience === "resfinance-api" &&
    value.network_id === "pinned-local-network"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "ResWallet request failed";
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(value))
    throw new Error("seed must be exactly 64 hex characters");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
