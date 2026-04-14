# @vitronai/alethia

**The MCP bridge to Alethia** — AI agents test your app with plain English. ~13 ms per step, 45x faster than Playwright. Safe by default. Local-first. Zero telemetry.

[![npm version](https://img.shields.io/npm/v/@vitronai/alethia.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/@vitronai/alethia)
[![License: MIT](https://img.shields.io/badge/bridge-MIT-green.svg?logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![Patent Pending](https://img.shields.io/badge/runtime-Patent%20Pending-blue.svg?logo=shield&logoColor=white)](#patent-notice)
[![GitHub](https://img.shields.io/badge/source-GitHub-1f2328.svg?logo=github&logoColor=white)](https://github.com/vitron-ai/alethia-mcp)
[![Tessl](https://img.shields.io/badge/Tessl-Registry-5fb4f7.svg)](https://tessl.io/registry/vitron-ai/alethia)

---

## What this package does

This npm package is the **MIT-licensed MCP bridge** (~22 KB) — a thin stdio-to-HTTP relay. It auto-downloads the signed Alethia headless runtime on first use. No signup, no manual steps.

> **Note:** The MIT license on this bridge does **not** grant a patent license to the Alethia runtime (U.S. App. 19/571,437). Commercial use of the runtime may require a separate license. Contact **gatekeeper@vitron.ai**.

---

## Install

```bash
npm install -g @vitronai/alethia
```

Verify:

```bash
alethia-mcp --health-check
```

```
✓ Connected. MCP tools available.
  runtime version:  0.1.0-alpha.4
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

Same shape — point any MCP-compatible client at the `alethia-mcp` command.

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

---

## Usage

Once configured, ask your agent to test something:

> *"Use alethia_tell to navigate to the incident response page, assert the critical alert is visible, click Acknowledge, and assert it changed to Acknowledged."*

Alethia compiles plain English to Action IR, runs each step through the safety gate, and returns per-step results, a semantic page snapshot (~200 tokens), DOM diffs, policy audit records, and a SHA-256 integrity hash.

---

## Tools

| Tool | Purpose |
|---|---|
| `alethia_tell` | Run plain-English test steps. The main tool. ~13 ms/step. |
| `alethia_tell_parallel` | Run multiple test flows concurrently against different URLs. |
| `alethia_screenshot` | Capture a PNG of the current page. |
| `alethia_compile` | Preview what `tell` will run, without executing. |
| `alethia_eval` | Run raw JavaScript in the page under test. |
| `alethia_status` | Health check — version, config, kill switch state. |
| `alethia_audit_wcag` | WCAG 2.1 AA accessibility audit (14 criteria, Section 508). |
| `alethia_audit_nist` | NIST SP 800-53 security controls audit (8 controls). |
| `alethia_export_session` | Export a signed evidence pack of the entire session. |
| `alethia_activate_kill_switch` | Emergency halt — stops all automation immediately. |
| `alethia_reset_kill_switch` | Resume after a kill switch activation. |

Destructive actions (delete, purchase, transfer) are **blocked by default** under the `controlled-web` profile. Sensitive input (passwords, credit cards) is **always blocked** unless `allowSensitiveInput: true` is explicitly passed.

---

## Demos

Ready-to-use demo pages ship in the `demo/` folder. Start with the Claude Code demo:

### Claude Code: verify a generated app

Paste this into Claude Code:

```
Use alethia_serve_demo to start the demo server. Tell me the URL
for claude-code-app.html so I can open it in the preview panel.
Then use alethia_tell to navigate to that URL. Assert "TaskFlow"
is visible. Type dev@company.com into the "you@company.com" field.
Type Engineering into the "Your team name" field. Click Sign in.
Assert "Signed in as" is visible. Type "Deploy to production" into
the "Add a new task" field. Click Add. Assert "Deploy to production"
is visible. Click Delete and report what EA1 decides.
```

The agent starts a localhost server, gives you the URL to open in the preview panel, then drives the app. Watch clicks and form fills happen live as EA1 blocks the delete.

### More scenarios

| Demo | Scenario |
|---|---|
| `claude-code-app.html` | AI coding agents: sign in, dashboard, CRUD, EA1 blocks delete |
| `incident-response.html` | Defense / SOC: triage active cyber incident |
| `threat-intel.html` | Intelligence / CTI: APT tracking, IOC blocking |
| `crypto-readiness.html` | Cybersecurity / PQC: post-quantum migration |
| `agent-oversight.html` | AI Safety: autonomous agent monitoring, kill switch |
| `admin-panel.html` | Defense / Classified: TS/SCI admin panel |
| `financial-dashboard.html` | Finance / Trading: risk monitor, compliance checks |

Full prompts for each demo: [`demo/README.md`](./demo/README.md)

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
| `ALETHIA_VISIBLE` | (unset) | Set to `1` to show the browser window. Watch the agent drive your app in real time. |

---

## Troubleshooting

### "Alethia desktop runtime is not running on 127.0.0.1:47432"

1. Run `alethia-mcp --health-check` — triggers auto-install if the runtime isn't present
2. Check that the runtime process is running on `127.0.0.1:47432`
3. If auto-install failed, check your network and try again

### "DENY_WRITE_HIGH" in the audit log

A destructive action was blocked by the default safety policy. **This is correct behavior.** To allow it, pass `{ profile: 'open-web' }` — but understand you're opting out of the safety gate.

### "SENSITIVE_INPUT_DENIED"

A sensitive field was detected (password, token, credit card, etc.). Override with `{ "allowSensitiveInput": true }` only for legitimate auth/payment flow testing.

### MCP client doesn't see the tools

1. Verify: `alethia-mcp --health-check`
2. Check your MCP config
3. Restart your MCP client
4. Debug: set `ALETHIA_DEBUG=1`

---

## Go deeper

- [Architecture & how it works](https://vitron.ai/why)
- [VITRON-EA1 safety standard](https://vitron.ai/safety)
- [FAQ](https://vitron.ai/faq)
- [Releases](https://github.com/vitron-ai/alethia/releases)
- [Homepage](https://github.com/vitron-ai/alethia)

---

## License

MIT — see [LICENSE](./LICENSE). Covers **this MCP bridge only.**

## Patent Notice

The Alethia runtime is patent pending (U.S. Application No. 19/571,437). The MIT license on this bridge does **not** grant any patent license. For licensing: **gatekeeper@vitron.ai**.
