# Security Posture

Alethia is a local-first, agent-driven E2E automation runtime. This document is the partner-facing security story — the boundaries of what the runtime will do, the cryptographic chain that backs every claim, the threat model we defend against, and how to talk to us when something goes wrong.

**Short version for the skim:** the runtime refuses to navigate off local origins, signs its releases end-to-end with Ed25519, hashes every run with SHA-256, and has no telemetry path. The controls are architectural, not configurable.

---

## Local-only by architecture

The runtime refuses to navigate to any origin outside the local-origin allowlist. The allowlist is a **compile-time constant** enforced at four choke points inside every signed runtime we ship:

1. The explicit `NAVIGATE` step of `alethia_tell`.
2. The `url` argument of `alethia_propose_tests`.
3. The `url` argument of `alethia_assert_safety`.
4. Navigation attempts from the target page itself (link clicks, JS redirects, form submissions) that would leave the allowlist are cancelled at the network-request boundary before any bytes go out.

### What counts as local

- `file://`, `app://`, `data:`, `about:`
- `chrome-extension://`, `devtools://`
- `http(s)://` to `localhost`, `127.0.0.1`, `::1`
- `http(s)://` to any `.local` mDNS name
- `http(s)://` to RFC1918 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`

**Everything else is blocked.**

### What is NOT configurable

The allowlist is **not** exposed as:

- A CLI flag
- An environment variable
- An MCP tool argument
- A policy profile option
- A cockpit UI toggle
- A runtime setting
- A "developer mode" override

This is not a default we defend with "you shouldn't turn it off." It's a compile-time invariant. There is no switch.

When a design partner has a legitimate need to drive a specific production origin, the conversation is:

> We will issue a build signed for your organization that includes your origins in the allowlist. No other user's binary will carry those origins. If the build is misused, we stop signing new releases for that organization and pursue the applicable legal channels.

— not "here's a flag, good luck."

---

## Threat model

Who and what we defend against, and which control closes each class:

| Threat class | Example attack | What stops it |
|---|---|---|
| **Account takeover / credential stuffing** via agent driving | Malicious prompt tells the agent to hammer a login endpoint on a public site | Local-only invariant blocks the navigate before any request leaves the loopback interface |
| **CAPTCHA farms / abuse posting** at scale | Attacker runs Alethia headless against a social network | Local-only invariant refuses any navigate to a public origin |
| **Destructive action via prompt injection** | Malicious page or prompt tricks the agent into clicking a "Delete All" button | VITRON-EA1 policy gate classifies write-high actions and refuses unconditionally (no profile override) |
| **Sensitive input exfiltration** | Agent types a password / token / SSN / credit card into a logged or malicious field | Sensitive-input detector blocks the write; `allowSensitiveInput: true` is a per-call scoped opt-in for legitimate auth-flow tests |
| **Evidence-pack tampering** | Auditor receives a pack; attacker wants to alter history post-hoc | Canonical payload hashed with SHA-256; every step has its own per-step integrity hash; chained within the run |
| **Supply-chain attack on the runtime binary** | Attacker swaps the signed artifact on GitHub | Ed25519 signature on the release manifest, verified against the public key embedded in the bridge |
| **Supply-chain attack on the bridge package** | Attacker pushes a malicious `@vitronai/alethia` to npm | SHA-512 integrity check against the hash npm serves in the packument; major-version gate refuses `1.x → 2.x` auto-updates without explicit user action; optional `ALETHIA_BRIDGE_SRI` pin |
| **Stale / rolled-back runtime serving evidence** | Partner's auditor gets an evidence pack from a known-vulnerable version | Every evidence pack records the runtime + bridge + skill versions that produced it |
| **Kill-switch bypass** | Attacker re-enables automation after a human pulled the cord | Per-step policy gate stays armed across kill-switch toggles; only a human-side reset (`alethia_reset_kill_switch`) clears the halt |

## Cryptographic chain of custody

**Runtime binaries.** Every Alethia runtime release is signed with Ed25519. The public key ships embedded in the MCP bridge (`@vitronai/alethia`) so end-to-end verification is possible without trusting any network fetch:

1. Bridge downloads `manifest.json` from GitHub Releases.
2. Bridge verifies the Ed25519 signature on the canonical manifest using its embedded public key. A bad signature aborts the install.
3. Bridge downloads the platform-specific tarball and verifies its SHA-256 against the value in the signed manifest. A mismatch aborts the install.
4. Only then is the runtime extracted and spawned.

**Per-run integrity.** Every `alethia_tell` result includes a SHA-256 hash computed over a canonical representation of the `PlanRun` (steps, outcomes, policy decisions, timestamps). An auditor can re-compute the hash from the run payload and confirm the record hasn't been altered post-hoc.

**Evidence packs.** `alethia_export_session` returns the complete session recording wrapped in a canonical JSON structure and hashed with SHA-256. The pack records runtime version, bridge version, and skill content hash so auditors can reconstruct the exact three-component environment that produced the evidence.

**Verify a release yourself:**

```bash
# Download manifest + signature + public key from the release
# Then verify
openssl dgst -verify public-key.pem -signature manifest.sig manifest.json
# exit 0 = valid; anything else = reject the artifact
```

---

## Supply-chain posture

**Runtime distribution.** Signed artifacts on GitHub Releases at [vitron-ai/alethia](https://github.com/vitron-ai/alethia/releases). Every release manifest is Ed25519-signed; platform tarballs are SHA-256 hashed and verified against the signed manifest.

**Bridge distribution.** `@vitronai/alethia` on npm. Tarballs carry SHA-512 integrity hashes served by the npm registry. The bridge itself verifies these hashes when auto-updating from npm.

**npm provenance.** Not yet published with `--provenance`. This is a known gap. Tracked; planned for a near-term release. Until then, trust chain for the bridge relies on npm's signing infrastructure (the same chain every `npm install` user relies on).

**Dependency surface.** Bridge is ~9 KB of stdio-to-HTTP relay code with minimal dependencies. Runtime is a signed Electron app; its dependency tree is fixed at build time.

**Reproducibility.** `ALETHIA_RUNTIME_VERSION=x.y.z` + `ALETHIA_BRIDGE_VERSION=x.y.z` + `ALETHIA_BRIDGE_SRI=sha512-...` pin the exact runtime + bridge + bridge-tarball-hash for reproducible CI.

---

## Update cadence + rollback

**Runtime auto-update.** Bridge queries GitHub Releases for the current runtime on startup (cached 1 hour). If a newer release exists and the user hasn't pinned, the bridge downloads + verifies + installs it before spawning.

**Bridge auto-update.** Bridge queries the npm registry on startup (cached 1 hour). If a newer published version exists and the user hasn't pinned, the bridge downloads the signed tarball, verifies the SHA-512 integrity, extracts to `~/.alethia/bridge/<version>/`, and bootstraps into that version on next spawn.

**Rollback.** A new bridge version only becomes "trusted" after a successful MCP initialize handshake. Versions that crash before that handshake get quarantined after 3 attempts; bootstrap falls back to the last verified version.

**Version pins.** `ALETHIA_RUNTIME_VERSION=x.y.z` and `ALETHIA_BRIDGE_VERSION=x.y.z` pin exact versions for CI, bisection, or deliberate stay-behind. `ALETHIA_SKIP_AUTO_UPDATE=1` disables auto-updates entirely.

**Major-version gate.** Auto-updates proceed freely across patch and minor bumps within the same major version. Crossing a major (`1.x → 2.x`) requires an explicit manual upgrade. This blocks a hypothetical "attacker publishes v99.0.0" scenario.

---

## Logging & telemetry

**No cloud telemetry.** The runtime never emits telemetry to any network endpoint. There is no analytics client, no usage pings, no "phone home" path in the signed binary.

**What lives locally.** Audit records for every tool call (policy decision, reason code, step detail, timestamp) are held in memory within the running session. They are written to the local evidence pack only when the agent explicitly calls `alethia_export_session`. Nothing leaves the machine unless the user moves the pack themselves.

**What Claude Code / Cursor / Cline see.** Same MCP protocol as every other tool: they see the inputs and results of the tool calls they themselves make. The runtime does not share session data across MCP clients.

**Kill switch.** `alethia_activate_kill_switch` halts all current and queued automation and keeps the per-step policy gate armed. Subsequent tool calls return `KILL_SWITCH_ACTIVE` until reset by a human via `alethia_reset_kill_switch`.

---

## Yanked releases

Every Alethia runtime binary published before v0.2.4 has been yanked, and every `@vitronai/alethia` bridge version below 0.3.27 has been deprecated on npm. Pre-v0.2.4 binaries either lacked the local-origin gate (pre-v0.2.3) or allowed a caller-supplied `profile='open-web'` argument to bypass the EA1 write-high block (v0.2.3). See [YANKED.md](https://github.com/vitron-ai/alethia/blob/main/YANKED.md) for the full list and remediation steps if you have a pre-v0.2.4 binary locally.

## Patent + fork boundary

The runtime source is closed. The public surfaces are:

- **[alethia](https://github.com/vitron-ai/alethia)** — signed release binaries only, no source.
- **[alethia-mcp](https://github.com/vitron-ai/alethia-mcp)** — MIT-licensed bridge that speaks JSON-RPC to a runtime you already have. The MIT license **does not** grant a patent license under U.S. Application No. 19/571,437.
- **[alethia-starter](https://github.com/vitron-ai/alethia-starter)** — test target only.

A reimplementation of the runtime from scratch that reproduces the claimed behaviors would infringe. Do not fork to bypass the local-only invariant or the EA1 policy gate.

## Reporting security issues

Bugs that weaken the local-only boundary, the policy gate, the evidence-pack integrity, the signed-release verification, or any control listed in the threat model above should be reported to **`gatekeeper@vitron.ai`** rather than filed as a public GitHub issue. We will acknowledge within 72 hours and coordinate a disclosure timeline. Do not include reproduction details in public issues.

## Reporting abuse

If you observe Alethia being used against non-local origins — through a modified binary, a downstream fork, a leaked design-partner build, or any other mechanism — email **`gatekeeper@vitron.ai`** with whatever detail you can share. We will yank the affected release, stop signing new builds for the responsible party, and pursue applicable legal channels.

---

_Contact: gatekeeper@vitron.ai_
