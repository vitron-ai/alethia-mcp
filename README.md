# @vitronai/alethia

> **The MIT-licensed MCP bridge to Alethia** — the patent-pending zero-IPC E2E test runtime built for AI agents.
> **45× faster than Playwright** on the localhost test loop. Fail-closed by default. Cryptographically chained audit packs. **Local-first. Zero telemetry by default. Opt-in cloud.**

[![npm version](https://img.shields.io/npm/v/@vitronai/alethia.svg)](https://www.npmjs.com/package/@vitronai/alethia)
[![License: MIT](https://img.shields.io/badge/bridge-MIT-green.svg)](./LICENSE)
[![Patent Pending](https://img.shields.io/badge/runtime-Patent%20Pending-blue.svg)](#patent-notice)

---

## ⚠️ This is the MCP bridge — the runtime is separate

**This npm package is the open-source MCP bridge — a thin (~22 KB) stdio→HTTP relay**, MIT-licensed and freely usable. It does not contain the runtime. By itself it cannot drive a browser, run a test, or do anything except forward MCP requests to a local HTTP endpoint.

**The Alethia desktop runtime** — the part that actually contains the patent-pending in-process zero-IPC executor, the VITRON-EA1 policy gate, and the NLP compiler — is **closed-source, patent-pending**, and currently distributed through the **design-partner alpha program**.

| Component | License | How to get it |
|---|---|---|
| `@vitronai/alethia` (this npm package — the MCP bridge) | **MIT, open source** | `npm install -g @vitronai/alethia` |
| Bridge source mirror | **MIT, open source** | [github.com/vitron-ai/alethia-mcp](https://github.com/vitron-ai/alethia-mcp) |
| **Alethia desktop runtime** (the patented in-process executor) | **Closed-source, Patent Pending — U.S. App. 19/571,437** | Design-partner alpha. Request access: **gatekeeper@vitron.ai** |

**The MIT license on this bridge does not, under any circumstances, grant any patent license under U.S. Application No. 19/571,437 or any other vitron.ai patent rights.** The runtime is a separate licensable artifact. Public binary releases of the runtime ship with the v0.3 milestone.

**Bottom line for developers:** installing this npm package is free and unrestricted. Using the actual Alethia runtime in production requires either (a) the design-partner alpha (free during the alpha period, by request) or (b) a future commercial license once the patent grants.

---

## Why Alethia?

Your agent generates a Next.js app on `localhost:3000` and your users want it verified. Playwright adds **600ms of CDP marshalling tax** to every assertion — and worse, it's async-by-construction, so the agent's decide-act-verify loop is racing against stale DOM snapshots between every `await`.

Alethia is a different shape entirely. The driver and the DOM live in **the same V8 isolate**:

| | Playwright (CDP) | Alethia (zero-IPC) |
|---|---|---|
| Avg latency per step | 580 ms | **13 ms** |
| p95 latency per step | 654 ms | **24 ms** |
| Process boundary | 3 (test ↔ driver ↔ browser) | **0** between driver and DOM |
| DOM access | async, marshalled, race-prone | **synchronous, in-process** |
| Per-step safety policy | none | **VITRON-EA1 fail-closed gate** |
| Audit trail | trace viewer (debugging) | **SHA-256 chained, Ed25519 signable** |
| Telemetry | on by default in cloud product | **off by default; opt-in only** |
| Patent moat | none | **U.S. App 19/571,437** |

Benchmarks: `click-assert-wait` scenario, 20 iterations. Numbers from `benchmarks/league-latest.json` in the [alethia-core](https://github.com/vitron-ai/alethia-core) repo.

---

## Install

### Step 1 — Install the MCP bridge from npm (this package)

```bash
npm install -g @vitronai/alethia
```

### Step 2 — Get the Alethia desktop runtime

The bridge alone does nothing — it's a relay. You also need the **Alethia desktop runtime** (the patent-pending closed-source Electron app) running locally on `127.0.0.1:47432`.

The desktop runtime is currently in **design-partner alpha**. To request access:

👉 **Landing page:** [github.com/vitron-ai/alethia](https://github.com/vitron-ai/alethia)
👉 **Request access:** **gatekeeper@vitron.ai**

Public binary releases ship with the v0.3 milestone. During the alpha, runtime access is free for design partners (typically AI coding agent tool builders integrating Alethia into their product).

### Verify the install

```bash
alethia-mcp --version
alethia-mcp --health-check
```

Expected:

```
✓ Connected. 5 MCP tools available.
  runtime version:  0.1.0-alpha.1
  default profile:  controlled-web
  kill switch:      inactive
```

---

## Configure your agent

### Claude Code

`~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "alethia": { "command": "alethia-mcp" }
  }
}
```

### Cursor

Cursor → Settings → MCP → Add server:

```json
{
  "alethia": { "command": "alethia-mcp" }
}
```

### Cline / Continue / any MCP client

Same shape. Any MCP-compatible client speaks the standard stdio protocol — point it at the `alethia-mcp` command.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "npx",
      "args": ["-y", "@vitronai/alethia"]
    }
  }
}
```

After saving the config, restart your MCP client.

---

## Usage

Once configured, your agent has five Alethia tools available. The most common one:

> *"Use alethia_tell to navigate to localhost:3000, sign in as admin@example.com / password123, and verify the dashboard heading is visible."*

The agent will call `alethia_tell` with that NLP, Alethia compiles to Action IR, runs through the VITRON-EA1 policy gate, executes step by step, and returns a `PlanRun` with per-step results, policy audit records, and an integrity hash.

---

## Tools

### `alethia_tell`
Execute natural-language test instructions. The headline tool.

```
nlp: "navigate to http://localhost:3000/login
      type admin@example.com into the email field
      type password123 into the password field
      click Sign In
      assert the dashboard heading is visible"
```

Returns a `PlanRun`:
```json
{
  "ok": true,
  "elapsedMs": 87,
  "stepRuns": [ /* per-step results */ ],
  "policyAudits": [ /* per-step EA1 decisions */ ],
  "integrity": {
    "algorithm": "sha256",
    "schemaVersion": "plan-run-v1",
    "payloadHash": "..."
  }
}
```

By default, **destructive actions are blocked** (`controlled-web` profile). The runtime catches verbs like *delete, purchase, transfer, submit payment* via NLP intent inference and prepends `!://write-high` markers in the IR. Sensitive input (passwords, credit cards, SSN) is **always blocked** unless the caller explicitly opts in via `allowSensitiveInput: true`.

### `alethia_compile`
Compile NL to Action IR **without executing**. Use this to preview what `alethia_tell` will run, debug NLP coverage gaps, or generate reproducible IR scripts for CI.

### `alethia_status`
Liveness probe + identity. Returns runtime version, default policy profile, kill switch state, driver stats, current page domain, and capabilities. Call this before sending `tell()` calls to verify the runtime is in a known-good state.

### `alethia_activate_kill_switch`
**Halt all current and queued automation immediately.** Per-step policy gate stays armed; subsequent `tell()` calls will be blocked with `KILL_SWITCH_ACTIVE` until reset. Optional `reason` argument lands in the audit trail.

### `alethia_reset_kill_switch`
Clear an active kill switch and reset the shared executor state. Re-enables `tell()` calls. The reset itself is logged.

---

## Architecture

```
┌────────────────────────┐
│  Your AI agent         │  Claude Code / Cursor / Cline / Continue / ...
│  speaks MCP stdio      │
└──────────┬─────────────┘
           │ stdio (JSON-RPC over newline-delimited JSON)
           ↓
┌────────────────────────┐
│  @vitronai/alethia     │  This npm package — ~22 KB
│  stdio → HTTP shim     │  - speaks MCP stdio inbound
└──────────┬─────────────┘  - wraps results in MCP content envelope
           │ HTTP POST 127.0.0.1:47432 (loopback only, never networked)
           ↓
┌────────────────────────┐
│  Alethia desktop app   │  Electron main process
│  local JSON-RPC server │  - tools/list, tools/call
└──────────┬─────────────┘  - loopback bind, never reachable from network
           │ webContents.executeJavaScript('window.__alethia.tell(...)')
           ↓
┌────────────────────────┐
│  Alethia renderer      │  Electron renderer process — IS the browser
│  zero-IPC runtime      │  - tell() → NLP compiler → Action IR
└──────────┬─────────────┘  - VITRON-EA1 policy gate (per-step, fail-closed)
           │ direct DOM access (no protocol, no marshalling)
           ↓
┌────────────────────────┐
│  The page under test   │
└────────────────────────┘
```

**Two process boundaries** between your agent and the runtime (agent ↔ shim, shim ↔ Electron). Then **zero** boundaries between the runtime and the DOM. That's the architectural difference that makes Alethia 45× faster than Playwright.

---

## CLI flags

```
alethia-mcp                  Run as a stdio MCP server (default)
alethia-mcp --version        Print the version and exit
alethia-mcp --help           Print usage and exit
alethia-mcp --health-check   Probe the Alethia desktop app and exit 0/1
alethia-mcp --debug          Run with debug logging on stderr
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALETHIA_HOST` | `127.0.0.1` | Host of the Alethia desktop app |
| `ALETHIA_PORT` | `47432` | Port of the Alethia desktop app |
| `ALETHIA_TIMEOUT_MS` | `60000` | Per-request timeout in milliseconds |
| `ALETHIA_DEBUG` | (unset) | Set to `1` to enable debug logging on stderr |

---

## Troubleshooting

### "Alethia desktop runtime is not running on 127.0.0.1:47432"

The npm package you installed is the **MCP bridge only** — a thin relay. The actual runtime (the Electron app containing the patent-pending zero-IPC executor) is a separate, closed-source artifact distributed through the design-partner program.

**To get runtime access:**
👉 [github.com/vitron-ai/alethia](https://github.com/vitron-ai/alethia)
👉 **gatekeeper@vitron.ai**

Public binary releases ship in v0.3. Once you have the runtime and launch it, you should see in its console:

```
[alethia] local RPC server listening on 127.0.0.1:47432
```

Then re-run your MCP client and `alethia-mcp --health-check` should print `✓ Connected`.

### "DENY_WRITE_HIGH" in the audit log

The runtime blocked a destructive action under the default fail-closed policy. **This is correct behaviour** for an AI-agent-facing test runtime — destructive actions need explicit consent.

To allow them, pass `{ profile: 'open-web' }` in the `alethia_tell` arguments. But understand: you're opting out of the safety gate.

### "SENSITIVE_INPUT_DENIED"

The runtime blocked typing into what looks like a sensitive field (matches `password`, `token`, `secret`, `credit card`, `ssn`, etc.). To override for a legitimate auth-flow test:

```json
{ "nlp": "...", "allowSensitiveInput": true }
```

Only do this when you are knowingly testing a real auth or payment flow.

### MCP client doesn't see the tools

1. Verify the desktop app is running: `alethia-mcp --health-check`
2. Verify your MCP config points at the correct command
3. Restart your MCP client (some clients cache server lists)
4. Run with debug logging: set `ALETHIA_DEBUG=1` in your MCP config's `env` section

### `Script failed to execute`

The Electron renderer hasn't loaded `window.__alethia` yet (or crashed). Restart the desktop app. If it persists, file an issue.

---

## Privacy & data flow

Alethia is **local-first with zero telemetry by default.**

- **The MCP bridge** (this npm package) only speaks to `127.0.0.1` (loopback). It cannot reach any other host. No data leaves your machine through the bridge — verify yourself by reading [`src/index.ts`](./src/index.ts), it's ~590 lines, single file.
- **The desktop runtime** has a production webRequest filter that blocks all non-`file://`, non-`app://`, non-`localhost` requests. The runtime is **architecturally loopback-only** in production builds.
- **Zero telemetry collection** in v0.2 — the runtime does not phone home, does not collect usage metrics, does not report crashes anywhere by default.
- **Future cloud features** (signed evidence as a service, team dashboards, agent observability) will be **opt-in only**, clearly labeled, with disclosed data flow. They are separate paid products you explicitly enroll in — not defaults that turn on silently.

The bottom line: **what you install today does nothing on the network beyond your machine.** When the cloud product ships, it's a separate, opt-in choice you make explicitly.

---

## License

MIT — see [LICENSE](./LICENSE).

The MIT license covers **this MCP bridge package only**. The underlying Alethia Core runtime is proprietary and closed-source.

## Patent Notice

Alethia Core practices a method that is the subject of:

- **U.S. Patent Application No. 19/571,437** (non-provisional)
- Claiming priority to **U.S. Provisional Application No. 63/785,814** (filed April 9, 2025)
- **Title:** *"Deterministic Local Automation Runtime with Zero-IPC Execution, Offline Operation, and Per-Step Policy Enforcement"*
- **Status:** Patent Pending — U.S. Patent and Trademark Office

The MIT license on this MCP bridge does **not** grant any patent license under U.S. Application No. 19/571,437 or any other vitron.ai patent rights.

For licensing inquiries: **gatekeeper@vitron.ai**

---

## Links

- 🏠 Homepage: [github.com/vitron-ai/alethia](https://github.com/vitron-ai/alethia)
- 📦 Source: [github.com/vitron-ai/alethia-mcp](https://github.com/vitron-ai/alethia-mcp)
- 📥 Releases: [github.com/vitron-ai/alethia/releases](https://github.com/vitron-ai/alethia/releases)
- 📧 Licensing: gatekeeper@vitron.ai
