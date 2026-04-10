# Alethia — Zero-IPC E2E Testing for AI Agents

Alethia is a patent-pending, local-first E2E test runtime that runs the driver and the DOM in the same V8 isolate. ~45x faster than Playwright on the localhost test loop.

## Quick start

```bash
npm install -g @vitronai/alethia
```

The bridge auto-installs the signed headless runtime on first use. No signup, no email gate.

## MCP setup

Add to your agent's MCP config (`.mcp.json`, Claude Code settings, Cursor MCP, etc.):

```json
{
  "mcpServers": {
    "alethia": { "command": "alethia-mcp" }
  }
}
```

## MCP tools

| Tool | Purpose |
|---|---|
| `alethia_tell` | Execute natural-language test instructions. The headline tool. ~13 ms per step. |
| `alethia_compile` | Compile NL to Action IR without executing. Preview before you run. |
| `alethia_status` | Health probe. Version, profile, kill switch state, driver stats. |
| `alethia_activate_kill_switch` | Halt all automation immediately. Logged in audit trail. |
| `alethia_reset_kill_switch` | Clear an active kill switch. Re-enables `tell()` calls. |
| `alethia_screenshot` | Capture a PNG screenshot of the current page. Visual verification for agent loops. |
| `alethia_eval` | Evaluate a JS expression in the page under test. Escape hatch for raw DOM queries. |

## How alethia_tell works

Send plain English instructions:

```
navigate to file:///path/to/app.html
click Sign In
assert the dashboard heading is visible
```

Alethia compiles to Action IR, runs each step through the VITRON-EA1 fail-closed policy gate, executes with synchronous DOM access, and returns a PlanRun with per-step results, DOM diffs, a semantic page snapshot, policy audit records, and a SHA-256 integrity hash.

Every response includes:
- **DOM diffs** — what changed after each step (added, removed, changed elements)
- **Page snapshot** — structured page state (~200 tokens): headings, buttons, form state, list counts, errors
- **Smart error context** — on failure, returns near-matches and suggested fixes

## Safety: VITRON-EA1

Default profile is `controlled-web`:
- **read** (navigation, assertions) — always allowed
- **write-low** (form input, drafts) — allowed by default
- **write-high** (delete, purchase, submit) — blocked by default
- Sensitive input (passwords, credit cards) — blocked in all profiles unless explicitly opted in

The policy gate is in-process — agents cannot bypass it.

## Privacy

Everything runs on your machine. The runtime listens on `127.0.0.1:47432` (loopback only). Zero telemetry by default. The only network call is the one-time runtime download on first install.

## Links

- npm: [npmjs.com/package/@vitronai/alethia](https://www.npmjs.com/package/@vitronai/alethia)
- Bridge source (MIT): [github.com/vitron-ai/alethia-mcp](https://github.com/vitron-ai/alethia-mcp)
- Landing page: [github.com/vitron-ai/alethia](https://github.com/vitron-ai/alethia)
- Website: [vitron.ai](https://vitron.ai)
- Licensing: gatekeeper@vitron.ai
