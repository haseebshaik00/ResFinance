import { ReconnectingPort } from "./reconnecting-port";
import { TrustedActivityReporter } from "./trusted-activity";

const pageSource = "resfinance-page";
const vaultSource = "reswallet";

const port = new ReconnectingPort(
  () => {
    const connected = chrome.runtime.connect({ name: "resfinance-page" });
    return {
      postMessage: (message) => connected.postMessage(message),
      onMessage: {
        addListener: (listener) => connected.onMessage.addListener(listener),
      },
      onDisconnect: {
        addListener: (listener) =>
          connected.onDisconnect.addListener(() => listener()),
      },
    };
  },
  (message) => {
    if (
      !isObject(message) ||
      message.source !== vaultSource ||
      message.version !== 1
    )
      return;
    window.postMessage(message, window.location.origin);
  },
  (callback) => {
    window.setTimeout(callback, 250);
  },
);

port.start();

const activityReporter = new TrustedActivityReporter(() => {
  port.postMessage({
    source: "reswallet-content",
    version: 1,
    type: "USER_ACTIVITY",
  });
});

const activityEvents = [
  "keydown",
  "pointerdown",
  "pointermove",
  "touchstart",
  "wheel",
] as const;
for (const eventType of activityEvents) {
  window.addEventListener(
    eventType,
    (event) => {
      activityReporter.observe(event, document.visibilityState === "visible");
    },
    { capture: true, passive: true },
  );
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin)
    return;
  const message = event.data;
  if (
    !isObject(message) ||
    message.source !== pageSource ||
    message.version !== 1
  )
    return;
  if (
    message.type !== "GET_IDENTITY" &&
    message.type !== "GET_STATUS" &&
    message.type !== "SIGN_INTENT" &&
    message.type !== "LOCK"
  ) {
    return;
  }
  port.postMessage(message);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
