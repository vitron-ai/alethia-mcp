# Alethia — Agent-Native E2E with Verifiable Safety

Alethia is the patent-pending zero-IPC E2E runtime built for AI agents. Your agent writes the tests, runs them against a real browser, and proves destructive actions are blocked by a per-step policy gate — with a cryptographic audit trail and no cloud. 2–5× faster than Playwright MCP per flow; up to 50× faster than Playwright CLI on simple flows ([benchmark](https://github.com/vitron-ai/alethia-anvil/blob/main/benchmark/README.md)).

## Quick start

```bash
npm install -g @vitronai/alethia
```

The bridge auto-installs the signed headless runtime on first use. No signup, no email gate. Works with `file://` pages and `http://localhost` dev servers.

### Starter repo — try it in 30 seconds

Fork [alethia-anvil](https://github.com/vitron-ai/alethia-anvil) and point your agent at `__alethia__/`. Ships a 250-line SPA called Anvil and 14 `.alethia` test files covering CRUD, search, priority, bulk actions, keyboard shortcuts, tab filters, toast stack, export — plus the `expect block:` safety test. Drop-in GitHub Actions workflow + runner included.

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
| `alethia_propose_tests` | Scan a URL and generate a candidate NLP test suite — agent bootstraps coverage in one call. Auto-wraps destructive actions in `expect block:`. |
| `alethia_assert_safety` | Walk every destructive action on a page and verify the EA1 policy gate blocks each one. Automated compliance proof. |
| `alethia_tell` | Execute natural-language test instructions. ~13 ms per step. Returns per-step DOM diffs, near-matches, suggested fixes, and structured page context on every call. |
| `alethia_compile` | Compile NL to Action IR without executing. Preview before you run. |
| `alethia_status` | Health probe. Version, profile, kill switch state, driver stats. |
| `alethia_screenshot` | Capture a PNG screenshot of the current page. Visual verification for agent loops. |
| `alethia_eval` | Evaluate a JS expression in the page under test. Escape hatch for raw DOM queries. |
| `alethia_audit_wcag` | WCAG 2.1 AA accessibility audit — 14 criteria. Section 508 compliance. |
| `alethia_audit_nist` | NIST SP 800-53 security controls audit — 8 controls. |
| `alethia_tell_parallel` | Run multiple test flows concurrently against different URLs. |
| `alethia_serve_demo` | Start a localhost server for built-in demo pages. Opens in preview panels. |
| `alethia_show_cockpit` | Toggle the live oversight window on during a session. |
| `alethia_hide_cockpit` | Toggle the live oversight window off during a session. |
| `alethia_export_session` | Export signed evidence pack — SHA-256 chained proof of every agent action in this session. |
| `alethia_activate_kill_switch` | Halt all automation immediately. Logged in audit trail. |
| `alethia_reset_kill_switch` | Clear an active kill switch. Re-enables `tell()` calls. |

## How alethia_tell works

Send plain English instructions against any local page:

```
navigate to file:///path/to/demo/incident-response.html
assert CRITICAL INCIDENT ACTIVE is visible
click Acknowledge
assert Acknowledged is visible
expect block: click Delete Incident
```

Alethia compiles to Action IR, runs each step through the VITRON-EA1 fail-closed policy gate, executes with synchronous DOM access, and returns structured per-step results with DOM diffs, semantic page snapshot, policy audit records, and a SHA-256 integrity hash.

## Verifiable safety primitive — `expect block:`

`expect block:` is an NLP assertion unique to Alethia. The step **passes** if the EA1 gate blocks it, **fails** if the gate lets it through. This turns Alethia from "a test runner" into "a verifiable-safety framework" — you can regression-test your app's safety boundary itself.

Other frameworks can assert "nothing destructive happened" by inspecting the app's state after a click; only Alethia's assertion is that the *runtime itself refused* to let the click through in the first place. Meaningfully different guarantee.

## Structured response fields

Every `alethia_tell` response now returns top-level:

- **`nearMatches`** — elements close to the failed selector
- **`suggestedFix`** — corrected selector the agent can retry with
- **`pageContext`** — `{ title, headings, buttons, inputs }`

This feeds agent self-repair loops: a mis-selected click comes back with concrete candidates the agent can choose from instead of prose it has to regex-parse.

## Safety: VITRON-EA1

Default profile is `controlled-web`:
- **read** (navigation, assertions) — always allowed
- **write-low** (form input, drafts) — allowed by default
- **write-high** (delete, purchase, submit) — blocked by default
- Sensitive input (passwords, credit cards, PII) — blocked in all profiles unless explicitly opted in

The policy gate is in-process — agents cannot bypass it.

## Privacy

Everything runs on your machine. The runtime listens on `127.0.0.1:47432` (loopback only). Zero telemetry by default. The only network call is the one-time signed runtime download on first install.

## Security posture — local-only by architecture

Alethia refuses to navigate to any origin outside `file://`, `localhost`, `127.0.0.1`, `::1`, `.local`, and RFC1918 private ranges. The allowlist is a **compile-time constant** enforced at four choke points in every signed binary we ship — NAVIGATE, `alethia_propose_tests`, `alethia_assert_safety`, and the renderer-level `will-navigate` / `will-redirect` handlers. It is **not** exposed as a CLI flag, env var, MCP argument, policy profile, or UI toggle. Design-partner production-origin access is handled by issuing a custom-signed build with those origins baked in, never by shipping a general-purpose override. See [vitron.ai/safety](https://vitron.ai/safety).

## Links

- npm: [npmjs.com/package/@vitronai/alethia](https://www.npmjs.com/package/@vitronai/alethia)
- Bridge source (MIT): [github.com/vitron-ai/alethia-mcp](https://github.com/vitron-ai/alethia-mcp)
- Runtime releases: [github.com/vitron-ai/alethia](https://github.com/vitron-ai/alethia)
- Starter template: [github.com/vitron-ai/alethia-anvil](https://github.com/vitron-ai/alethia-anvil)
- Website: [vitron.ai](https://vitron.ai)
- Licensing: gatekeeper@vitron.ai
