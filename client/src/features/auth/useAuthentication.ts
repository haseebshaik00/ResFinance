import { useCallback, useEffect, useRef, useState } from "react";

import {
  createChallenge,
  createSession,
  logoutSession,
} from "../../lib/api/client";
import {
  formatIntentTimestamp,
  getWalletStatus,
  hashParameters,
  lockWallet,
  signIntent,
  subscribeWalletStatus,
  type WalletIdentity,
  type WalletStatus,
} from "./reswallet";

export type AuthenticationState =
  | "checking"
  | "disconnected"
  | "locked"
  | "ready"
  | "pending"
  | "signing-in"
  | "authenticated"
  | "error";

interface Authentication {
  state: AuthenticationState;
  message: string;
  identity: WalletIdentity | null;
  actorAddress: string | null;
  accessToken: string | null;
  connect(): Promise<void>;
  logout(): Promise<void>;
}

export function useAuthentication(): Authentication {
  const [state, setState] = useState<AuthenticationState>("checking");
  const stateRef = useRef<AuthenticationState>("checking");
  const [message, setMessage] = useState("Checking wallet and session state…");
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [actorAddress, setActorAddress] = useState<string | null>(null);

  const transitionTo = useCallback((next: AuthenticationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const applyWalletStatus = useCallback(
    (current: WalletStatus, preserveActiveSession = false) => {
      setIdentity(current.identity);
      if (
        preserveActiveSession &&
        (stateRef.current === "authenticated" ||
          stateRef.current === "pending" ||
          stateRef.current === "signing-in")
      ) {
        return;
      }
      transitionTo(
        !current.exists || current.identity === null
          ? "disconnected"
          : current.unlocked
            ? "ready"
            : "locked",
      );
      setMessage(walletStatusMessage(current));
    },
    [transitionTo],
  );

  const inspectWallet = useCallback(
    async (preserveActiveSession = false) => {
      try {
        applyWalletStatus(await getWalletStatus(), preserveActiveSession);
      } catch {
        if (preserveActiveSession) return;
        setIdentity(null);
        transitionTo("disconnected");
        setMessage(
          "Install the ResWallet extension to use wallet authentication.",
        );
      }
    },
    [applyWalletStatus, transitionTo],
  );

  useEffect(
    () => subscribeWalletStatus((status) => applyWalletStatus(status, true)),
    [applyWalletStatus],
  );

  useEffect(() => {
    const refreshVisibleWallet = () => void inspectWallet(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshVisibleWallet();
    };
    window.addEventListener("focus", refreshVisibleWallet);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshVisibleWallet);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [inspectWallet]);

  useEffect(() => {
    void inspectWallet();
  }, [inspectWallet]);

  const connect = useCallback(async () => {
    transitionTo("pending");
    setMessage("Preparing a short-lived login challenge…");
    try {
      const status = await getWalletStatus();
      if (!status.exists || status.identity === null)
        throw new Error("ResWallet is not initialized.");
      if (!status.unlocked) {
        setIdentity(status.identity);
        transitionTo("locked");
        setMessage("ResWallet is Locked!");
        return;
      }
      setIdentity(status.identity);
      const challenge = await createChallenge(status.identity);
      const origin = window.location.origin;
      const parameters = { challenge: challenge.challenge, origin };
      const issuedAt = new Date();
      setMessage("Review and approve the sign-in request in ResWallet!");
      const intent = await signIntent({
        version: 1,
        intent_id: crypto.randomUUID(),
        action: "auth.login",
        resource_id: challenge.challenge_id,
        parameters,
        parameters_hash: await hashParameters(parameters),
        nonce: crypto.randomUUID(),
        issued_at: formatIntentTimestamp(issuedAt),
        expires_at: formatIntentTimestamp(
          new Date(issuedAt.getTime() + 5 * 60 * 1000),
        ),
        origin,
        audience: "resfinance-api",
        network_id: "pinned-local-network",
      });
      transitionTo("signing-in");
      setMessage("Approval Received! Signing you in to ResFinance…");
      const session = await createSession(challenge.challenge, intent);
      setAccessToken(session.access_token);
      setActorAddress(session.actor_address);
      transitionTo("authenticated");
      setMessage(
        "Wallet challenge approved. Access token is held in memory only.",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Wallet authentication failed.";
      if (errorMessage === "ResWallet is locked") {
        transitionTo("locked");
        setMessage("ResWallet is Locked!");
      } else {
        transitionTo("error");
        setMessage(errorMessage);
      }
    }
  }, [transitionTo]);

  const logout = useCallback(async () => {
    if (accessToken === null) return;
    try {
      await logoutSession(accessToken);
    } finally {
      try {
        await lockWallet();
      } catch {
        // The backend session is still revoked if the extension is unavailable.
      }
      setAccessToken(null);
      setActorAddress(null);
      await inspectWallet();
    }
  }, [accessToken, inspectWallet]);

  return {
    state,
    message,
    identity,
    actorAddress,
    accessToken,
    connect,
    logout,
  };
}

function walletStatusMessage(status: WalletStatus): string {
  if (!status.exists || status.identity === null)
    return "Initialize ResWallet before connecting...";
  if (!status.unlocked) return "ResWallet is Locked!";
  return "ResWallet Unlocked! Connect to Wallet now...";
}
