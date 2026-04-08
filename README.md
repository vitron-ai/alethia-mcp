# @vitronai/alethia

> **The MCP bridge to Alethia** — the patent-pending zero-IPC E2E test runtime built for AI agents.
> **45× faster than Playwright** on the localhost test loop. Fail-closed by default. Cryptographically chained audit packs. Local-first, no telemetry.

[![npm version](https://img.shields.io/npm/v/@vitronai/alethia.svg)](https://www.npmjs.com/package/@vitronai/alethia)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Patent Pending](https://img.shields.io/badge/Patent-Pending-blue.svg)](#patent-notice)

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
| Telemetry | optional cloud | **none, ever** |
| Patent moat | none | **U.S. App 19/571,437** |

Benchmarks: `click-assert-wait` scenario, 20 iterations. Numbers from `benchmarks/league-latest.json` in the [alethia-core](https://github.com/vitron-ai/alethia-core) repo.

---

## Install

```bash
npm install -g @vitronai/alethia
```

You also need the **Alethia desktop app** running locally. Download the latest signed build:
👉 [github.com/vitron-ai/alethia/releases](https://github.com/vitron-ai/alethia/releases)

The desktop app starts a loopback JSON-RPC server on `127.0.0.1:47432`. The npm package above is a thin **stdio→HTTP shim** that lets MCP-capable AI agents call into it.

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
│  @vitronai/alethia     │  This npm package — ~9 KB
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

### "Alethia desktop app is not running on 127.0.0.1:47432"

The desktop app isn't running. Download it:
👉 [github.com/vitron-ai/alethia/releases](https://github.com/vitron-ai/alethia/releases)

Launch it. You should see in its console:

```
[alethia] local RPC server listening on 127.0.0.1:47432
```

Then re-run your MCP client.

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

## Privacy

Everything runs on your machine. **No cloud. No telemetry. No data leaves your network.** The bridge above only ever speaks to `127.0.0.1` (loopback). The desktop app's network filter blocks all non-`file://`, non-`app://`, non-`localhost` requests in production builds.

The bridge source is open and auditable: the entirety of what this package does is in [`src/index.ts`](./src/index.ts).

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
