# Milestone 2: ResWallet — Custom Hardened ResVault & Wallet Authentication

Status: Finalized and project-owner accepted for local development

Evidence date: 2026-10-13 America/Los_Angeles

Finalization date: 2026-10-24 America/Los_Angeles

The project owner has accepted the delivered ResWallet functionality and
presentation for the declared local-development scope. No remaining owner-side
ResWallet tasks are tracked; the non-production limits below remain unchanged.

## Why ResFinance created ResWallet

1. **What we adopted and why the original was not sufficient:** ResWallet keeps the original ResVault browser-wallet concept: a wallet supplies the user's signing identity and asks the user to approve actions. The pinned ResVault audit found that the original implementation returned decrypted private-key material to webpage code, persisted raw passwords, stored an exportable encryption key beside encrypted data, and allowed overly broad website messaging. Those findings required a different security architecture.
2. **What we changed:** We built the ResWallet extension for ResFinance and replaced the original storage, unlock, page-bridge, and signing paths. ResWallet encrypts its seed with Argon2id and AES-256-GCM, keeps passwords and unlocked key material in extension memory only, and performs Ed25519 signing inside the extension background context.
3. **What ResWallet adds:** ResWallet accepts requests only from explicitly approved origins, binds each signature to the action and its security context, and presents an extension-owned approval screen before signing. The webpage receives only the public identity and approved signed result; the private key and seed remain inside ResWallet.

## Delivered boundaries

- A custom ResWallet Manifest V3 extension under `reswallet/`, implemented from the accepted ADR after the original ResVault storage and signing bridge failed the security audit.
- One versioned encrypted-seed record using Argon2id and AES-256-GCM. The local policy is 64 MiB, three iterations, parallelism one, a 16-byte random salt, a 12-byte random nonce, and a 32-byte derived key.
- Memory-only passwords, derived keys, decrypted seeds, and signing state. The vault locks after five minutes, extension suspension, page logout, explicit lock, or extension restart.
- An exact-origin content bridge restricted to `https://app.resfinance.local` and the checked local Vite origin. It returns only the public key, derived address, lock state, approved signed intent, or a public error. The bridge reconnects when the Manifest V3 worker suspends and publishes lock-state changes to the open ResFinance page without exposing secrets.
- A compact, extension-owned approval popup anchored to the ResWallet toolbar action in the same Chrome 127+ window. The ResFinance page remains visible behind it while the popup displays the action, requesting origin, resource, network, expiry, and material parameters before the user chooses **Approve & Login**.
- RFC 8785-compatible canonical intent signing with Ed25519 and signatures bound to action, parameters hash, resource, nonce, origin, audience, network, issuance, and expiry.
- FastAPI challenge, session, refresh, and logout endpoints under `/api/v1/auth`.
- Opaque access tokens held only in API and browser memory. The refresh token is stored only as a SHA-256 hash in ResilientDB and delivered as an HttpOnly, SameSite=Strict cookie.
- Append-only ResilientDB challenge-use, nonce-use, refresh-session, rotation, revocation, and authentication audit records.
- A wallet-login screen that uses the generated `/api/v1` client, keeps the ResFinance mark beside the authentication heading, labels the public wallet address, provides inline setup guidance, requests extension approval, keeps the access token in React memory, and locks ResWallet on logout. Opening the application only checks public wallet status; it never restores an authenticated dashboard from a refresh cookie, so every browser visit requires the user to select **Connect Wallet** and approve a fresh challenge. While authentication is pending, the card distinguishes **Review and approve the sign-in request in ResWallet** from **Approval Received! Signing you in to ResFinance**, with matching **Waiting for approval** and **Signing in** button labels. Locked and unlocked status changes appear without a page refresh through the extension broadcast, with a focus/visibility status check as a reconnect fallback. The logged-out card cannot retain authenticated controls.
- Keyboard-accessible ResWallet creation and unlock forms. Enter creates a new wallet or submits the unlock password exactly like the corresponding button. A failed password displays **Incorrect Password** in red, and the locked popup displays a blinking bulb beside **ResWallet is Locked!** The ready state labels **Your Wallet Address**, keeps **Lock now** full width, and explains that the private key never leaves ResWallet before its five-minute inactivity lock.
- A pinned native ResilientDB KV client in the FastAPI container; no substitute persistence was introduced.

Exact upstream and cryptography revisions are recorded in [`config/milestone2-lock.json`](../../config/milestone2-lock.json). The built extension remains a local-development implementation; this evidence does not claim browser-store review, production key custody, cloud support, or production readiness.

## Security acceptance

Automated coverage proves:

- A restarted extension is locked until an explicit unlock.
- Wrong passwords cannot decrypt the seed.
- Signing while locked, without approval, after timeout, or from the wrong origin fails.
- Altered parameters, wrong networks, expired requests, duplicate wallet nonces, altered signatures, used challenges, and rotated refresh-token replay fail.
- The TypeScript extension signature matches the Python RFC 8785/Ed25519 verifier through a shared compatibility vector.
- The built manifest has no `<all_urls>` permission and the page bridge posts only to the exact page origin.
- The content bridge contains no seed, password, private-key, derived-key, mnemonic, or ciphertext field.
- A disconnected content-script port is replaced after worker suspension, and only the public wallet status is broadcast to the application page after create, import, unlock, lock, delete, or automatic lock.
- Authentication approval opens from the toolbar in the requesting tab's Chrome window instead of creating a separate desktop window.
- Logout forces the client back through the current wallet-status inspection, preventing authenticated GitHub, theme, notification, or logout controls from remaining inside the logged-out card.
- Storage contains one encrypted-seed record plus public metadata; no raw password, seed, access token, refresh token, or login challenge is persisted.

## Real-stack acceptance

The checked runner created and approved a wallet challenge, established a refresh session through ResilientDB, restarted all four replicas and the client proxy, reconstructed the authentication service, and refreshed successfully. It then proved that the old rotated refresh token, the used challenge, and the logged-out session were rejected.

The rebuilt FastAPI container separately passed the live HTTP flow through its pinned native KV client:

- Challenge: `201`
- Session: `201`
- Refresh rotation: `200`
- Rotated-token replay: `401`
- Logout: `204`
- Wrong origin: `403`

The sanitized record is [`config/milestone2-local-attestation.json`](../../config/milestone2-local-attestation.json).

## Verification

```bash
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest
.venv/bin/python -m scripts.generate_openapi
docker compose config --quiet

cd client
npm ci
npm run generate:api
npm run check
npm run lint
npm run format:check
npm test
npm run build

cd ../reswallet
npm ci
npm run check
npm run lint
npm run format:check
npm test
npm run build
npm run security:inspect
```

Real ResilientDB and live API acceptance:

```bash
docker compose --profile tools up -d --build \
  resdb-1 resdb-2 resdb-3 resdb-4 resdb-proxy resdb-tools
.venv/bin/python -m scripts.milestone2.run_auth_acceptance

docker compose --profile app up -d --build api
.venv/bin/python -m scripts.milestone2.run_http_auth_acceptance
```

To load the local extension, build `reswallet/`, open the Chromium extensions page, enable developer mode, and load `reswallet/dist` as an unpacked extension. Generated `dist/` output is intentionally not committed.
