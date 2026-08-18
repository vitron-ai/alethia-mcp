# @vitronai/alethia

**Agent-native E2E with verifiable safety.** Your agent drives a real browser with plain English, and destructive actions are blocked by a safety gate you can prove works — with a signed audit trail and no cloud.

[![npm version](https://img.shields.io/npm/v/@vitronai/alethia.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/@vitronai/alethia)
[![License: MIT](https://img.shields.io/badge/bridge-MIT-green.svg?logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![Patent Pending](https://img.shields.io/badge/runtime-Patent%20Pending-blue.svg?logo=shield&logoColor=white)](#patent-notice)
[![GitHub](https://img.shields.io/badge/source-GitHub-1f2328.svg?logo=github&logoColor=white)](https://github.com/vitron-ai/alethia-mcp)

---

## Install

**Claude Code — fastest path (plugin):**

```
/plugin marketplace add vitron-ai/alethia-mcp
/plugin install alethia@vitronai
```

This wires up both the MCP server and the skill in one step — no manual `npm install` or MCP config editing. Restart or run `/reload-plugins` to activate.

**Claude Code — skill only (no plugin manager):**

```bash
mkdir -p ~/.claude/skills/alethia && \
  curl -fsSL https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/skills/alethia/SKILL.md \
    -o ~/.claude/skills/alethia/SKILL.md
```

Restart Claude Code. Next time you ask it to test a page, it notices Alethia isn't configured yet and walks you through installing the bridge itself.

**Everyone else (Claude Desktop, Cursor, Cline, Continue):**

```bash
npm install -g @vitronai/alethia
```

Then add this to your client's MCP config:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "alethia-mcp"
    }
  }
}
```

| Client | Config file |
|---|---|
| Claude Code | `~/.claude/mcp.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Cursor | Settings → MCP → Add server (paste the inner `"alethia": {...}` object only, no `mcpServers` wrapper) |
| Cline / Continue / other | The client's own MCP config file |

Restart your client after saving. The runtime auto-downloads (signed, ~100 MB) the first time your agent calls an Alethia tool. A cockpit window opens by default so you can watch — set `ALETHIA_HEADLESS=1` to hide it; CI hides it automatically.

<details>
<summary>Advanced install options — always-latest spawn, version pinning, upgrading</summary>

**Upgrade the bridge:** `npm install -g @vitronai/alethia@latest`. Since 0.6.0 you don't need a new bridge for new runtime versions — it queries GitHub Releases on every start.

**Always run the latest without manually upgrading:**

```json
{
  "mcpServers": {
    "alethia": {
      "command": "npx",
      "args": ["-y", "@vitronai/alethia@latest"]
    }
  }
}
```

The `@latest` suffix matters — without it, `npx -y` can serve a stale cached version. Trade-off: adds 10–30s on a cold cache, and every spawn pulls whatever npm is currently serving (a global install is the safer default for compliance-sensitive work, since it only changes when you explicitly upgrade it).

**Pin a specific runtime version** (reproducible CI, bisection):

```json
"env": { "ALETHIA_RUNTIME_VERSION": "0.4.0" }
```

**Install the Claude Code skill** (optional, teaches Claude when to use each tool):

```bash
alethia-mcp --install-skill
```

</details>

---

## What to ask for

You don't call these tools directly — just ask your agent in plain English, and it picks the right one.

| Ask for it | What happens |
|---|---|
| *"Sign in and verify the dashboard loads."* | Drives the browser, reports what changed and whether anything was blocked. |
| *"Generate tests for this page — I haven't covered it yet."* | Scans the page and drafts a starter test suite, with a safety check for every destructive control it finds. |
| *"Prove the safety gate blocks destructive actions on this page."* | Finds every destructive action and confirms the gate blocks each one — a per-action pass/fail report. |
| *"Audit this page for accessibility."* | A real WCAG 2.1 AA audit, via axe-core. |
| *"Audit this page for compliance and security."* | Checks against 8 NIST SP 800-53 controls. |
| *"Export a signed evidence pack of everything you just did."* | A tamper-evident record of the session — hand it to an auditor. |
| *"Check the dashboard and the settings page at the same time."* | Runs several tests concurrently, one per page. |
| *"Take a screenshot."* / *"How many items are in that list?"* | Visual check, or an answer plain English can't give you directly (counts, computed styles). |
| *"Stop everything right now — something looks wrong."* | Immediate halt. Only clears from the cockpit itself — an agent can't release its own kill switch. |

Typing into password, token, or credit-card fields is blocked unless you frame the request as a real login or payment test — the agent enables that for you, you don't need to name a flag.

**More paste-ready examples:** the [agent cookbook](./docs/agent-cookbook.md) has full walkthroughs — bootstrapping tests on an unknown page, a full compliance pass, parallel multi-page checks, a live partner demo. Every one is a literal prompt you paste in.

---

## Add Alethia to your project

No per-project install needed — once the MCP server is configured, any agent in any project can use it.

1. **Drop a `.alethia` file anywhere** your repo treats as test code — `tests/e2e/`, wherever fits.

   ```
   # tests/e2e/login.alethia
   name login flow
   navigate to http://127.0.0.1:5173
   assert "Sign in" is visible
   click Sign in
   type dev@company.com into the email field
   assert dashboard is visible
   ```

2. **Ask your agent to run it:** *"Run tests/e2e/login.alethia against http://127.0.0.1:5173."*

3. **In CI**, run it without an agent or MCP host at all:
   ```bash
   alethia run tests/e2e/login.alethia
   ```
   Exits 0 on pass, 1 on fail. Drop-in workflow: [`examples/github-actions.yml`](examples/github-actions.yml).

A working reference (demo app + specs + CI + benchmark) lives at [vitron-ai/alethia-anvil](https://github.com/vitron-ai/alethia-anvil).

---

## Why not just Cypress or Playwright?

| | Cypress / Playwright | Alethia |
|---|---|---|
| Who writes the test | a human, in a `.spec` file | an AI agent, in plain English |
| Proving destructive actions are blocked | manual review | one prompt — an automated, machine-readable report |
| Speed per step | ~200 ms (Playwright MCP), ~2 s (Playwright CLI) | ~13 ms — [reproduce the numbers yourself](https://github.com/vitron-ai/alethia-anvil#verify-the-faster-than-cdp-based-tools-claim-yourself) |
| Evidence | screenshots, videos | a signed evidence pack |
| Network | telemetry on by default for most cloud dashboards | air-gap deployable — zero telemetry, bound to 127.0.0.1 |

It's not only a testing tool, either — ask an agent to check `getComputedStyle()` or `offsetWidth` on a page it's actively building, and you get a live, uncached answer straight from the DOM instead of a reload-and-inspect cycle.

**Go deeper:** [Architecture](https://vitron.ai/why) · [Safety gate](https://vitron.ai/safety) · [FAQ](https://vitron.ai/faq) · [UI patterns for agent-driven testing](./docs/ui-for-agents.md)

---

<details>
<summary><strong>Reference — CLI flags, environment variables, how the bridge updates itself, troubleshooting</strong></summary>

### CLI flags

```
alethia-mcp                  Run as a stdio MCP server (default)
alethia-mcp run <path>       Run an NLP test file from the shell (CI mode)
alethia-mcp run --nlp "..."  Run inline NLP from the shell
alethia-mcp run -            Read NLP from stdin
alethia-mcp --version        Print the version and exit
alethia-mcp --health-check   Probe the Alethia runtime and exit 0/1
alethia-mcp --debug          Run with debug logging on stderr
```

A shorter `alethia` alias (same binary) is also installed, so the run subcommand can be invoked as `alethia run <path>`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALETHIA_HOST` / `ALETHIA_PORT` | `127.0.0.1` / `47432` | Where the runtime listens |
| `ALETHIA_TIMEOUT_MS` | `60000` | Per-request timeout |
| `ALETHIA_HEADLESS` | unset (visible) | `1` hides the cockpit window. CI environments auto-hide. |
| `ALETHIA_HIGHLIGHTS` | on for `tell` | Per-step highlights on the target. `0` disables for headless/max-speed runs. |
| `ALETHIA_RUNTIME_VERSION` | unset (latest) | Pin the runtime to a specific version for reproducible CI |
| `ALETHIA_RUNTIME_DIR` | `~/.alethia/runtime` | Where the auto-installed runtime lives |
| `ALETHIA_BRIDGE_VERSION` | unset | Pin the bridge itself, skip the npm auto-update check |
| `ALETHIA_BRIDGE_SRI` | unset | Require the auto-downloaded bridge tarball to match this `sha512-...` hash |
| `ALETHIA_SKIP_AUTO_UPDATE` | unset | `1` disables the bridge's npm registry check entirely |
| `ALETHIA_DEBUG` | unset | `1` for debug logging on stderr |

### How the bridge keeps itself current

- The runtime auto-installs on first use from signed GitHub releases (Ed25519-verified). The bridge asks GitHub what the current version is on first start (cached 1h) — no version pin lives in the bridge source, so a globally-installed bridge keeps pulling current runtimes as they ship.
- The bridge also auto-updates itself (since 0.8.0): checks npm on startup, verifies the tarball's SHA-512, installs to `~/.alethia/bridge/<version>/`. Never crosses a major version without explicit action; a new version only becomes trusted after it completes a real MCP handshake, and versions that crash before that get quarantined after 3 attempts.
- The bundled Claude Code skill auto-refreshes the same way — each spawn compares it to `~/.claude/skills/alethia/SKILL.md` and overwrites if stale.

### Troubleshooting

**"Alethia desktop runtime is not running"** — run `alethia-mcp --health-check` (triggers auto-install if missing). If that fails, check network reachability to GitHub.

**"WRITE_HIGH" / "EA1 POLICY BLOCK" in the audit log** — a destructive action was blocked. This is correct, fail-closed behavior — not an error to fix. Widening it requires human configuration; an agent can't do it from inside a call.

**"SENSITIVE_INPUT_DENIED"** — a password/token/credit-card field was detected. Only override with `allowSensitiveInput: true` for legitimate auth/payment tests.

**MCP client doesn't see the tools** — run `alethia-mcp --health-check`, check your config shape, restart the client, and set `ALETHIA_DEBUG=1` to log bridge traffic.

**"Server transport closed unexpectedly" / bridge exits silently** — usually a stale cached bridge. If using `npx -y @vitronai/alethia` without `@latest`, add it or run `rm -rf ~/.npm/_npx`. If using a global install, run `npm install -g @vitronai/alethia@latest`. Then fully quit and restart your client (Cmd-Q on macOS, not just close the window).

**"I see a new release on GitHub but my runtime hasn't upgraded"** — the "what's current" check is cached for 1 hour. Bust it with `rm ~/.alethia/.latest-release ~/.alethia/.bridge-registry-cache`, then restart your client.

</details>

<details>
<summary><strong>Security, privacy, and license</strong></summary>

### Security posture

The runtime is local-only **by architecture**: its signed binary refuses to navigate anywhere outside `file://`, `localhost`, `127.0.0.1`, `.local`, and RFC1918 private ranges. This is a compile-time constant — no flag, env var, or UI toggle changes it. Full threat model and disclosure process: [`SECURITY.md`](./SECURITY.md). Abuse reports: **team@vitron.ai**.

### Privacy

Local-only by architecture — nothing is collected, transmitted, or stored outside your machine. Page content, screenshots, and test instructions are processed locally and never sent anywhere. Evidence packs are written to your filesystem only on explicit request. Zero telemetry, zero analytics, zero crash reporting. Questions: **team@vitron.ai**.

### License and patent notice

This bridge is **MIT-licensed** — see [LICENSE](./LICENSE). The Alethia runtime itself is **patent pending** (U.S. Application No. 19/571,437); the MIT license on this bridge does **not** grant a patent license to the runtime. Commercial runtime use may require a separate license. Licensing inquiries: **team@vitron.ai**.

</details>
