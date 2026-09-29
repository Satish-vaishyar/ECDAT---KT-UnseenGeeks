# ECDAT IDE 🛡️

> Code-OSS / VS Code extension that turns your editor into a **post-quantum cryptography IDE** for security operators.

## What ships

- **Inline crypto diagnostics** — broken (`MD5`/`SHA-1`/`DES`/`3DES`/`RC4`/…), vulnerable (`RSA < 2048`, `DH < 2048`), deprecated (`RSA-2048`, `ECDSA-P256`, `Ed25519`, `X25519`).
- **One-click QuickFix** — `MD5` → `blake2b`, `SHA-1` → `sha256`, `RC4` → `chacha20`, `DES` → `AES-256`, `Math.random()` → `crypto.randomBytes`/`SecureRandom`/`secrets.token_bytes`, `ECB` → `GCM`, RSA/ECDH/EdDSA → ML-KEM-768 / ML-DSA-65 / Ed448 hybrid.
- **Per-file PQC readiness score (0-100)** in the status bar + workspace aggregate.
- **4 Activity Bar panels** — Crypto Findings, Quantum Risk Lab, Compliance, Threat Intel.
- **Q-Day P50 countdown** in the status bar — click for detail.
- **`@ecdat` chat participant** — red-team review, PQC scoring, Monte Carlo, CBOM export, CVE search.
- **10-view SOC Console** embedded as a Webview (loads your existing `D:\sih2\frontend\index.html`).
- **ECDAT Secure theme** — SOC-tuned dark palette with severity colors.
- **Welcome walkthrough** — 5-step onboarding.
- **Remote gateway support** — `ecdat.gateway.url` setting, falls back to MOCK when unreachable.
- **On-demand CBOM (CycloneDX 1.6)** export to `ecdat-cbom.json`.

## Install

```bash
cd D:\sih2\ecdat-ide-extension
npm install
npm run package
# → ecdat-ide-1.0.0.vsix
code --install-extension ecdat-ide-1.0.0.vsix
```

Or in Code-OSS: Extensions → ⋯ → *Install from VSIX*.

## Connect to your gateway

Default: `http://localhost:8000`. Override in `settings.json`:

```json
{
  "ecdat.gateway.url": "https://ecdat.internal:8443",
  "ecdat.gateway.apiKey": "${env:ECDAT_TOKEN}"
}
```

## Build the .vsix

```bash
npm ci
npx vsce package --no-dependencies
```

## Source layout

```
src/
  extension.ts          ← activate, command registrations
  cryptoDetector.ts     ← 30+ regex patterns + algorithm registry
  findingsProvider.ts   ← Side panel TreeView with severity buckets
  riskProvider.ts       ← Quantum Risk Lab from gateway
  complianceProvider.ts ← FIPS 203/204/205 / CNSA 2.0 / CERT-In / DPDP
  threatProvider.ts     ← NVD / CISA KEV / TrapDoor
  statusBar.ts          ← Q-Day, file score, workspace score, MOCK/LIVE badge
  gatewayClient.ts      ← HTTP client + local CBOM builder
  consolePanel.ts       ← Webview hosting D:\sih2\frontend\index.html
  remediator.ts         ← QuickFix and bulk auto-remediate
  scanner.ts            ← Workspace walker
  copilot.ts            ← @ecdat chat participant
media/
  ecdat-icon.svg        ← Activity Bar + Copilot icons
  findings/quantum/compliance/threat icons
  frontend/             ← index.html + app.js + styles.css + data.js + ecdat-bridge.js
themes/
  ecdat-secure.json     ← Dark SOC theme
walkthrough/
  intro/theme/gateway/scan/console.md
```
