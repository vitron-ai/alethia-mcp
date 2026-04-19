# @vitronai/alethia

**Agent-native E2E with verifiable safety.** Alethia is the zero-IPC E2E runtime built for AI agents. Your agent writes the tests, runs them against a real browser, and proves destructive actions are blocked by a per-step policy gate — with a cryptographic audit trail and no cloud.

[![npm version](https://img.shields.io/npm/v/@vitronai/alethia.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/@vitronai/alethia)
[![License: MIT](https://img.shields.io/badge/bridge-MIT-green.svg?logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![Patent Pending](https://img.shields.io/badge/runtime-Patent%20Pending-blue.svg?logo=shield&logoColor=white)](#patent-notice)
[![GitHub](https://img.shields.io/badge/source-GitHub-1f2328.svg?logo=github&logoColor=white)](https://github.com/vitron-ai/alethia-mcp)

---

## What this package is

This package is the **MIT-licensed MCP bridge** (~22 KB) — a thin stdio-to-HTTP relay that lets any MCP client (Claude Code, Cursor, Cline, Continue, Claude Desktop) drive the Alethia desktop runtime. It auto-downloads the signed runtime on first use.

The cockpit is an **oversight surface**, not an authoring IDE. Humans do not write tests in a GUI. Agents propose tests, run them, and prove safety — humans review the evidence.

> **Patent notice.** The MIT license on this bridge does **not** grant a patent license to the Alethia runtime (U.S. Application No. 19/571,437). Commercial runtime use may require a separate license. Contact **gatekeeper@vitron.ai**.

---

## Why Alethia

| | Cypress / Playwright | Alethia |
|---|---|---|
| Who writes the test | a human, in a `.spec` file | an AI agent, in plain English |
| Per-step policy gate | none | VITRON-EA1 fail-closed, write-high blocked by default |
| Destructive-action proof | manual review | `alethia_assert_safety` — automated, machine-readable |
| Speed | ~580 ms/step (CDP overhead) | ~13 ms/step |
| Evidence | screenshots, videos | signed evidence pack with per-step integrity hashes |
| Network | Telemetry on by default; optional cloud dashboards | **Air-gap deployable** — no cloud product, no telemetry path, bound to 127.0.0.1 |

---

## Install

```bash
npm install -g @vitronai/alethia
```

Verify:

```bash
alethia-mcp --health-check
```

Expected:

```
Connected. MCP tools available.
  runtime version:  0.2.0
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
    "alethia": {
      "command": "alethia-mcp",
      "env": {
        "ALETHIA_VISIBLE": "1",
        "ALETHIA_HIGHLIGHTS": "1"
      }
    }
  }
}
```

With `ALETHIA_VISIBLE=1`, the Alethia cockpit opens alongside your agent. The target app loads inside the cockpit, so the Alethia UI stays visible during the run and highlights each step live (green = click/assert pass, blue = type, red = EA1 block).

### Cursor

Cursor > Settings > MCP > Add server:

```json
{ "alethia": { "command": "alethia-mcp" } }
```

### Cline / Continue / any MCP client

Same shape — point the client at the `alethia-mcp` command.

### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

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

---

## Your 5-minute demo

Three prompts. The agent does the rest.

### 1. Start the bundled demo server

> *"Use `alethia_serve_demo` and tell me the financial dashboard URL."*

Returns a `http://127.0.0.1:<port>/financial-dashboard.html` URL.

### 2. Let the agent write the tests

> *"Use `alethia_propose_tests` against that URL."*

The agent receives a 4–6 test block suite that includes, among others:

```
name EA1 Safety Gate Verification
navigate to http://127.0.0.1:47432/demo/financial-dashboard.html
expect block: click Liquidate All
expect block: click Wire Funds
expect block: click Purge Audit Log
```

`expect block:` is an Alethia-specific primitive. The step passes only when EA1 refuses to let the action fire. No other E2E framework can express this assertion.

### 3. Run them

> *"Run the proposed tests with `alethia_tell`, one block at a time."*

Per-step results, DOM diffs, a ~200-token semantic page snapshot, policy audit records, and a SHA-256 integrity hash come back on each call. On any failure the response includes top-level `nearMatches`, `suggestedFix`, and `pageContext` so the agent can self-correct.

### 4. Prove safety

> *"Use `alethia_assert_safety` on that URL."*

The runtime walks every destructive control on the page and runs `expect block:` against each. Returns:

```json
{
  "passed": true,
  "totalDestructive": 3,
  "blocked": 3,
  "results": [
    { "action": "Liquidate All", "blocked": true,  "detail": "..." },
    { "action": "Wire Funds",    "blocked": true,  "detail": "..." },
    { "action": "Purge Audit Log", "blocked": true, "detail": "..." }
  ]
}
```

### 5. Export the evidence

> *"Use `alethia_export_session` and save the result."*

Returns a signed JSON pack with every tool call, input, output, policy decision, and a chained SHA-256 hash over the record. Chain-of-custody quality.

---

## Tools

| Tool | Purpose |
|---|---|
| `alethia_tell` | Run plain-English test steps. Returns per-step results, `nearMatches`, `suggestedFix`, `pageContext`, and an integrity hash. |
| `alethia_propose_tests` | Scan a local URL (localhost, 127.0.0.1, file://, or RFC1918), return a candidate test suite including auto-wrapped `expect block:` for destructive actions. |
| `alethia_assert_safety` | Walk every destructive control on a local URL, verify the EA1 gate blocks each one. |
| `alethia_tell_parallel` | Concurrent multi-page test execution. |
| `alethia_compile` | Preview what `tell` will run without executing. |
| `alethia_screenshot` | Capture a PNG of the current page. |
| `alethia_eval` | Raw JavaScript in the page under test (policy-gated). |
| `alethia_status` | Version, policy profile, kill switch state. |
| `alethia_audit_wcag` | WCAG 2.1 AA accessibility audit — 14 criteria. |
| `alethia_audit_nist` | NIST SP 800-53 Rev. 5 security controls audit. |
| `alethia_export_session` | Signed evidence pack of the whole session. |
| `alethia_activate_kill_switch` / `alethia_reset_kill_switch` | Emergency halt and resume. |
| `alethia_serve_demo` | Start the bundled localhost demo server. |

Destructive actions (delete, purchase, transfer, liquidate, revoke, terminate, ...) are blocked by default under the `controlled-web` profile. Sensitive-input fields (passwords, tokens, credit cards) are blocked unless `allowSensitiveInput: true` is passed. Profile overrides from the agent are stripped by the bridge — profile changes require human configuration.

Full input/output schemas are available at runtime via the MCP `tools/list` method — every MCP-capable client surfaces the schemas automatically.

---

## Instruction primitives at a glance

```
navigate to <url>
click <text-or-selector>
type "<value>" into <field>
assert <text> is visible
assert <text> is not visible
wait <ms>
wait for <selector>
press <key> on <selector>
scroll to <selector>
hover <selector>
select <option> from <dropdown>
if <condition> exists, click <target>
expect block: <action>         # policy-verification assertion
```

`expect block:` is the primitive that lets an agent prove the safety gate works. Passes if EA1 blocks, fails if EA1 allows.

---

## CLI flags

```
alethia-mcp                  Run as a stdio MCP server (default)
alethia-mcp --version        Print the version and exit
alethia-mcp --help           Print usage and exit
alethia-mcp --health-check   Probe the Alethia runtime and exit 0/1
alethia-mcp --debug          Run with debug logging on stderr
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALETHIA_HOST` | `127.0.0.1` | Host of the Alethia runtime |
| `ALETHIA_PORT` | `47432` | Port of the Alethia runtime |
| `ALETHIA_TIMEOUT_MS` | `60000` | Per-request timeout in milliseconds |
| `ALETHIA_DEBUG` | (unset) | Set to `1` for debug logging on stderr |
| `ALETHIA_VISIBLE` | (unset) | Set to `1` to show the cockpit window |
| `ALETHIA_HIGHLIGHTS` | (unset) | Set to `1` to overlay per-step highlights on the target |

---

## How it works

- This package is the MCP bridge. It translates MCP tool calls into requests to the Alethia runtime.
- The runtime listens on `127.0.0.1:47432` over loopback JSON-RPC. No cloud calls, no telemetry.
- The runtime auto-installs on first use from signed GitHub releases (Ed25519-verified).
- With `ALETHIA_VISIBLE=1`, the cockpit shows the target app and highlights each step live.

---

## Troubleshooting

### "Alethia desktop runtime is not running on 127.0.0.1:47432"

1. Run `alethia-mcp --health-check` — triggers auto-install if the runtime is missing.
2. Confirm the runtime process is listening on `127.0.0.1:47432`.
3. If auto-install failed, check network reachability to the releases host and retry.

### "DENY_WRITE_HIGH" in the audit log

A destructive action was blocked by the default `controlled-web` profile. This is correct behavior. Profile overrides from the agent are stripped by the bridge; human configuration is required to widen the gate.

### "SENSITIVE_INPUT_DENIED"

A sensitive field was detected (password, token, credit card, etc.). Override with `{ "allowSensitiveInput": true }` only for legitimate auth/payment flow tests.

### MCP client doesn't see the tools

1. Run `alethia-mcp --health-check`.
2. Check your MCP config shape.
3. Restart your MCP client.
4. Set `ALETHIA_DEBUG=1` to log bridge traffic on stderr.

---

## Go deeper

- [Architecture and how it works](https://vitron.ai/why)
- [VITRON-EA1 safety standard](https://vitron.ai/safety)
- [FAQ](https://vitron.ai/faq)
- [Releases](https://github.com/vitron-ai/alethia/releases)

---

## Security posture — local-only by architecture

The Alethia runtime (which this bridge connects to) is local-only **by architecture**, not by default setting. Its signed binary refuses to navigate to any origin outside `file://`, `localhost`, `127.0.0.1`, `.local`, and RFC1918 private ranges. The allowlist is a compile-time constant — **not a CLI flag, env var, MCP argument, profile, or UI toggle**. For partner-specific production-origin access we issue custom-signed builds; we do not ship configurability.

Why this shape: Alethia's speed and stealth profile would make it an effective abuse tool if turned against the open web. It does not become that tool. Full posture at [vitron.ai/safety](https://vitron.ai/safety). Abuse reports: **gatekeeper@vitron.ai**.

---

## License

MIT — see [LICENSE](./LICENSE). Covers **this MCP bridge only.**

## Patent Notice

The Alethia runtime is patent pending (U.S. Application No. 19/571,437). The MIT license on this bridge does **not** grant any patent license. For licensing inquiries: **gatekeeper@vitron.ai**.
