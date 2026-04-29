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
| Speed (per call) | ~200 ms via Playwright MCP, ~2 s via Playwright CLI | ~40 ms — 2-5× faster than Playwright MCP; up to 50× vs Playwright CLI on simple flows — [reproduce the numbers yourself](https://github.com/vitron-ai/alethia-anvil#verify-the-faster-than-cdp-based-tools-claim-yourself) |
| Evidence | screenshots, videos | signed evidence pack with per-step integrity hashes |
| Network | Telemetry on by default; optional cloud dashboards | **Air-gap deployable** — no cloud product, no telemetry path, bound to 127.0.0.1 |

---

## Install

**Fastest path (Claude Code users):**

```bash
mkdir -p ~/.claude/skills/alethia && \
  curl -fsSL https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/skills/alethia/SKILL.md \
    -o ~/.claude/skills/alethia/SKILL.md
```

Restart Claude Code. Next time you ask to test a page or run a compliance audit, Claude notices the Alethia tools aren't wired up yet and walks you through installing the bridge with verbatim commands. No README hunt, no mcp.json editing from memory — the skill bootstraps itself.

**Traditional path (Claude Desktop / Cursor / Cline / Continue, or if you prefer doing it yourself):**

```bash
npm install -g @vitronai/alethia
```

Then configure your MCP client. Pick the section that matches what you're running — these are separate products with separate config files.

The bridge auto-installs the signed runtime on first use. The cockpit opens by default so you can watch the agent drive your app live (green = pass, blue = type, red = EA1 block). Set `ALETHIA_HEADLESS=1` to hide it. CI environments auto-hide.

### Configure your MCP client

The same server entry works everywhere — only the file path differs. Paste this into your client's MCP config:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "alethia-mcp"
    }
  }
}
```

| Client | Where it lives |
|---|---|
| Claude Code (VS Code extension / CLI) | `~/.claude/mcp.json` |
| Claude Desktop — macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop — Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop — Linux | `~/.config/Claude/claude_desktop_config.json` |
| Cline / Continue / any MCP-compliant client | The client's own MCP config — usually a JSON file in its extension settings dir |

Create the file if it doesn't exist. If it already has an `mcpServers` block, merge the `"alethia"` entry into it. Restart the client after editing so it picks up the server. Claude Desktop also exposes Settings → Developer → Edit Config as an in-app shortcut.

**Cursor** is the one exception — its UI takes the un-nested form (no `mcpServers` wrapper). Settings → MCP → Add server, then paste:

```json
{
  "alethia": {
    "command": "alethia-mcp"
  }
}
```

**Upgrading:** periodically run `npm install -g @vitronai/alethia@latest` to pick up new bridge versions. Since 0.6.0, a new bridge is no longer required for new runtime versions — the bridge queries GitHub Releases for the current runtime on every start.

### Claude Code skill (optional, recommended)

Alethia ships with a Claude Code skill that teaches Claude *when* to use each tool and how to compose them. Install it once:

```bash
alethia-mcp --install-skill
```

Copies `SKILL.md` to `~/.claude/skills/alethia/SKILL.md`. Claude Code auto-loads it on next start. After that, when you ask to test a page, run a compliance audit, or prove the EA1 gate, Claude invokes the right tool chain on its own — no cookbook lookup needed.

The skill works alongside the MCP server configured above; it's not a replacement for it.

**Self-heal behavior in both directions:**

- **If you configured the MCP server but haven't installed the skill**, the bridge's `initialize` response carries a one-time tip so Claude surfaces `alethia-mcp --install-skill` to you. The tip disappears once the skill file exists.
- **If someone has the skill but not the bridge** (say, copied `SKILL.md` from a friend), the skill's first section tells Claude to walk the user through the bridge install before attempting any tool call. No hallucinated results, no confusing missing-tool errors.

<details>
<summary>Advanced: always-latest spawn pattern</summary>

If you'd rather never manually upgrade, replace the command with:

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

**The `@latest` suffix matters.** Without it, `npx -y` uses whatever it cached on the first run — could be weeks out of date. With `@latest`, npx checks the registry each spawn and pulls a newer version if one exists.

Other trade-offs vs. a global install:

- **First-spawn latency:** adds 10–30s on a cold npm cache miss.
- **Supply-chain posture:** every spawn immediately pulls whatever the npm registry is serving. A global install shields you until you explicitly upgrade. For signed-evidence-sensitive use (regulated surfaces, compliance work), the global install is the safer default.

To pin a specific runtime version (reproducible CI, bisection, deliberate stay-behind):

```json
"env": { "ALETHIA_RUNTIME_VERSION": "0.4.0" }
```

</details>

---

## Your 5-minute demo

Five literal prompts. Paste each into Claude / Cursor / Cline in order. The agent runs Alethia for you.

The cockpit window opens automatically and paints each step live as the agent runs — green for pass, blue for type, red for EA1 block. (Since 0.8.3 the bridge defaults `highlights: true` for `alethia_tell` so a human watching sees the run; agents can pass `highlights: false` for max-speed CI runs, or set `ALETHIA_HIGHLIGHTS=0` in the spawn env.)

### 1. Start the bundled demo server

Paste:

> *"Use `alethia_serve_demo` to start the demo server and tell me the base URL."*

Returns something like `http://127.0.0.1:57307`. Every demo page lives under `<base>/<page>.html` — keep the URL handy for the next steps.

### 2. Smoke test the financial dashboard

Paste:

> *"Call `alethia_tell` with these instructions as a single block:*
>
> *navigate to `<base>/financial-dashboard.html`*
> *assert Risk Monitor is visible*
> *assert Open Positions is visible*
> *assert Compliance Checks is visible"*

Expected: 4 steps pass (1 navigate + 3 asserts). Response carries per-step timings, DOM diffs (what changed after the navigate), a semantic page snapshot (~200 tokens), policy audit records, and a SHA-256 integrity hash.

### 3. Prove the EA1 safety gate works

Paste:

> *"Call `alethia_tell` with these instructions as one block:*
>
> *navigate to `<base>/financial-dashboard.html`*
> *expect block: click Liquidate All*
> *expect block: click Purge Audit Log*
> *expect block: click Wire Funds"*

**`expect block:` is unique to Alethia.** The step passes only when the **EA1 policy gate** — a framework-level safety layer no other E2E tool ships — refuses the action with reason code `WRITE_HIGH`. Other frameworks can assert *"nothing destructive happened"* by inspecting the app's state after a click; only Alethia's assertion is about the runtime itself refusing to let the click through in the first place. Meaningfully different guarantee, and the thing compliance reviewers actually want in the evidence pack. This run should report all three clicks blocked.

Shortcut if you want Alethia to auto-discover destructive controls instead of naming them:

> *"Use `alethia_assert_safety` against `<base>/financial-dashboard.html`."*

Returns a per-action block/allow report with `totalDestructive`, `blocked`, and per-action detail.

### 4. Full compliance audit (WCAG + NIST + signed evidence)

Paste:

> *"Call `alethia_tell` to navigate to `<base>/wcag-audit.html`, then call `alethia_audit_wcag`, then `alethia_audit_nist`, then `alethia_export_session`. Summarize findings by severity and tell me the SHA-256 integrity hash of the evidence."*

Expected: a list of WCAG 2.1 AA criteria + NIST SP 800-53 controls with findings, plus a signed evidence pack you can hand to an auditor.

### 5. What a "block" is — and why we run one at a time

`alethia_propose_tests` returns **named test blocks**, each a cohesive multi-step flow:

```
Block 1 — Page Structure Verification (4 steps)
Block 2 — Safe Button Interactions (2 steps)
Block 3 — EA1 Safety Gate Verification (3 steps, all expect-block)
```

Calling `alethia_tell` once per block (rather than merging all blocks into one giant NLP string) is deliberate:

- **Each block becomes its own signed `PlanRun`** with its own integrity hash and its own history entry. Merged, you lose the audit boundary.
- **Named blocks stay named.** "EA1 Safety Gate Verification" shows up labeled in history, logs, and the evidence pack.
- **One block's failure doesn't sink the others.** Partial success + targeted rerun is the default.
- **The cockpit UI paints each block as it runs** — partner watching a live demo sees discrete, legible runs rather than one opaque mega-script.

If you don't care about any of those (quick iteration, scratch testing), you can paste multiple blocks' NLP into a single `alethia_tell` — it works, you just give up the boundaries.

---

**More paste-ready demos:** see the [agent cookbook](./docs/agent-cookbook.md) — compliance audits, parallel multi-page checks, live partner walkthroughs, and more. Every scenario is a literal prompt you drop into Claude / Cursor / Cline.

**Designing a UI to be driven by agents?** See [UI for agents](./docs/ui-for-agents.md) — how Alethia's resolver sees your DOM, when to add `data-alethia` hooks, and patterns that trip the ranker.

---

## Add Alethia to your project

Once the MCP is configured (above), Alethia is available to any agent in any project — no per-project install, no scaffold to run. To add tests:

1. **Create the directory.** Convention is `__alethia__/` at the project root, mirroring how Jest/Vitest treat `__tests__/`.

2. **Write a smoke test.** Plain English, one file per scenario:
   ```
   # __alethia__/smoke.alethia
   navigate to http://127.0.0.1:5173
   assert "Sign in" is visible
   ```

3. **Ask your agent to run it:**
   > *"Run the Alethia tests in `__alethia__/` against the app at http://127.0.0.1:5173."*

   The agent calls `alethia_tell` once per file and reports pass/fail.

4. **For CI**, copy [`ci-runner.mjs`](https://github.com/vitron-ai/alethia-anvil/blob/main/__alethia__/ci-runner.mjs) from alethia-anvil — a small stdio MCP client that pipes every `.alethia` file through the bridge and exits non-zero on failure. Wire it into GitHub Actions or your pipeline of choice.

5. **For evidence**, ask the agent to call `alethia_export_session` after a run — produces a signed evidence pack with per-step integrity hashes and full audit trail.

The full reference example lives at [**vitron-ai/alethia-anvil**](https://github.com/vitron-ai/alethia-anvil) — Anvil demo app + 14 spec files + CI workflow + the head-to-head Playwright/PW-MCP benchmark. Fork it to see the pattern end-to-end.

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
| `alethia_show_cockpit` / `alethia_hide_cockpit` | Toggle the live oversight window mid-session. |

Destructive actions (delete, purchase, transfer, liquidate, revoke, terminate, ...) are blocked by default under the hardened local-only profile. Sensitive-input fields (passwords, tokens, credit cards) are blocked unless `allowSensitiveInput: true` is passed. Profile overrides from the agent are stripped by the bridge — profile changes require human configuration.

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
alethia-mcp run <path>       Run an NLP test file from the shell (CI mode)
alethia-mcp run --nlp "..."  Run inline NLP from the shell
alethia-mcp run -            Read NLP from stdin
alethia-mcp run --help       Print run-mode help
alethia-mcp --version        Print the version and exit
alethia-mcp --help           Print usage and exit
alethia-mcp --health-check   Probe the Alethia runtime and exit 0/1
alethia-mcp --debug          Run with debug logging on stderr
```

The package also exposes a shorter `alethia` alias (same binary), so
the run subcommand can be invoked as `alethia run <path>`.

## Running in CI

The same NLP your agents use can run as your end-to-end test suite — no
agent in the loop, no MCP host required. The bridge ships a `run`
subcommand that drives the runtime headless and exits 0 (all passed) or 1
(any failed):

```bash
# from a file
alethia run tests/e2e/login.alethia

# inline
alethia run --nlp "navigate to http://localhost:3000
click Sign In
assert dashboard is visible"

# from stdin
cat tests/e2e/login.alethia | alethia run -
```

CI environments are auto-detected (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`,
`CIRCLECI`, `BUILDKITE`) and the cockpit window stays hidden. Pin a
specific runtime version for reproducible runs via
`ALETHIA_RUNTIME_VERSION=0.7.1`.

A drop-in GitHub Actions workflow is included at
[`examples/github-actions.yml`](examples/github-actions.yml).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALETHIA_HOST` | `127.0.0.1` | Host of the Alethia runtime |
| `ALETHIA_PORT` | `47432` | Port of the Alethia runtime |
| `ALETHIA_TIMEOUT_MS` | `60000` | Per-request timeout in milliseconds |
| `ALETHIA_DEBUG` | (unset) | Set to `1` for debug logging on stderr |
| `ALETHIA_HEADLESS` | (unset) | Set to `1` to hide the cockpit window. Default is visible. CI environments (`CI=1`, `GITHUB_ACTIONS`, etc.) auto-hide. |
| `ALETHIA_VISIBLE` | (unset) | **Deprecated** — set to `0` as a legacy alias for `ALETHIA_HEADLESS=1`. Removed in a future release. |
| `ALETHIA_HIGHLIGHTS` | (default on for `tell`) | Per-step highlights on the target. Default ON since 0.8.3 so a human watching the cockpit sees the run. Set to `0` to disable for headless / max-speed runs. Per-call `highlights:false` overrides this default. |
| `ALETHIA_RUNTIME_VERSION` | (unset) | Pin the bridge to a specific runtime version (e.g. `0.4.0`). By default the bridge queries GitHub Releases for the current latest runtime and downloads that. Use this for reproducible CI, bisection, or deliberately staying on an older runtime. |
| `ALETHIA_RUNTIME_DIR` | `~/.alethia/runtime` | Where the auto-installed runtime lives. Override for sandboxing or to stash multiple installs. |
| `ALETHIA_BRIDGE_VERSION` | (unset) | Pin the bridge itself to a specific version (e.g. `0.8.0`). Skips the npm auto-update check. For reproducible CI or deliberate stay-behind. |
| `ALETHIA_BRIDGE_SRI` | (unset) | Require any auto-downloaded bridge tarball to match this `sha512-<base64>` integrity string. Rejects everything else. For high-assurance deployments. |
| `ALETHIA_SKIP_AUTO_UPDATE` | (unset) | Set to `1` to disable the bridge's npm registry check entirely. The bridge runs as-installed, no background fetches. |

---

## How it works

- This package is the MCP bridge. It translates MCP tool calls into requests to the Alethia runtime.
- The runtime listens on `127.0.0.1:47432` over loopback JSON-RPC. No cloud calls, no telemetry.
- The runtime auto-installs on first use from signed GitHub releases (Ed25519-verified).
- **The bridge asks GitHub Releases what the current runtime version is on first start** (cached 1h). No RUNTIME_VERSION pin lives in the bridge source, so a globally-installed bridge keeps pulling the current runtime as new ones ship. Pin to a specific version with `ALETHIA_RUNTIME_VERSION=x.y.z` for reproducible CI or bisection.
- **The bridge also auto-updates itself** (since 0.8.0). On startup it checks npm for a newer published version, verifies the tarball against the SHA-512 integrity hash npm serves, and installs it to `~/.alethia/bridge/<version>/`. Next spawn bootstraps into the new version. Auto-update respects:
    - **Major-version gate:** never crosses `1.x → 2.x` without explicit user action
    - **Rollback:** a new version only becomes "trusted" after it successfully completes an MCP handshake; versions that crash before that get quarantined after 3 attempts
    - **Pin:** `ALETHIA_BRIDGE_VERSION=x.y.z` skips auto-update
    - **Integrity pin:** `ALETHIA_BRIDGE_SRI=sha512-...` rejects anything else
    - **Opt-out:** `ALETHIA_SKIP_AUTO_UPDATE=1` disables entirely
- **The Claude Code skill auto-refreshes too** (since 0.8.0). The bundled `SKILL.md` travels with every bridge release; each spawn compares it to `~/.claude/skills/alethia/SKILL.md` and overwrites if stale. New playbooks reach every user on their next spawn without any manual step.
- The cockpit is visible by default — it's the oversight surface where each step is highlighted live. Set `ALETHIA_HEADLESS=1` to hide, or toggle mid-session with `alethia_show_cockpit` / `alethia_hide_cockpit`.
- Evidence packs returned by `alethia_export_session` are wrapped with bridge name+version and skill content hashes (installed + bundled) for chain-of-custody reconstruction.

---

## Troubleshooting

### "Alethia desktop runtime is not running on 127.0.0.1:47432"

1. Run `alethia-mcp --health-check` — triggers auto-install if the runtime is missing.
2. Confirm the runtime process is listening on `127.0.0.1:47432`.
3. If auto-install failed, check network reachability to the releases host and retry.

### "WRITE_HIGH" / "EA1 POLICY BLOCK" in the audit log

A destructive action was blocked by the default `local-only` profile. This is correct behavior. Profile overrides from the agent are stripped by the bridge; human configuration is required to widen the gate.

### "SENSITIVE_INPUT_DENIED"

A sensitive field was detected (password, token, credit card, etc.). Override with `{ "allowSensitiveInput": true }` only for legitimate auth/payment flow tests.

### MCP client doesn't see the tools

1. Run `alethia-mcp --health-check`.
2. Check your MCP config shape.
3. Restart your MCP client.
4. Set `ALETHIA_DEBUG=1` to log bridge traffic on stderr.

### "Server transport closed unexpectedly" / bridge exits silently on spawn

Your client is spawning a stale bridge. Two likely causes:

**If you're using `npx -y @vitronai/alethia`** (without `@latest`), npx is serving a cached version that may predate the fix for this class of bug. Either add the `@latest` suffix to your config args or clear the npx cache:

```bash
rm -rf ~/.npm/_npx
```

Then fully restart your MCP client.

**If you're using a global install**, your globally installed bridge is old. Check and upgrade:

```bash
alethia-mcp --version
# If not the latest published version:
npm install -g @vitronai/alethia@latest
```

Then fully restart your MCP client (Cmd-Q on macOS, not just close the window).

Every 0.6.1+ bridge is symlink-spawn-safe — if you're on a current version and still see this, open an issue at https://github.com/vitron-ai/alethia-mcp/issues.

### "I see a new release on GitHub but my runtime hasn't upgraded"

The bridge caches the "what is the current runtime version?" lookup for 1 hour so we don't hammer the GitHub API on every spawn. If you want a new release to take effect immediately rather than waiting for cache expiry, bust the cache manually:

```bash
rm ~/.alethia/.latest-release ~/.alethia/.bridge-registry-cache 2>/dev/null
```

Then fully restart your MCP client (Cmd-Q → reopen). On the next spawn the bridge re-queries GitHub + npm, picks up the new versions, downloads + verifies + installs them.

The 1h TTL is a deliberate tradeoff. You can shorten it for CI or dev loops via `ALETHIA_SKIP_AUTO_UPDATE=1` + `ALETHIA_RUNTIME_VERSION=x.y.z` (pins an exact runtime, skips the check entirely).

---

## Go deeper

- [Architecture and how it works](https://vitron.ai/why)
- [VITRON-EA1 safety standard](https://vitron.ai/safety)
- [FAQ](https://vitron.ai/faq)
- [Releases](https://github.com/vitron-ai/alethia/releases)
- [Starter + benchmarks](https://github.com/vitron-ai/alethia-anvil) — working starter repo with CI, Playwright comparison kit, and reproducible numbers

---

## Security posture — local-only by architecture

The Alethia runtime (which this bridge connects to) is local-only **by architecture**, not by default setting. Its signed binary refuses to navigate to any origin outside `file://`, `localhost`, `127.0.0.1`, `.local`, and RFC1918 private ranges. The allowlist is a compile-time constant — **not a CLI flag, env var, MCP argument, profile, or UI toggle**. For partner-specific production-origin access we issue custom-signed builds; we do not ship configurability.

**Full security posture** — threat model, cryptographic chain of custody, supply-chain posture, update cadence, disclosure process — is at [`SECURITY.md`](./SECURITY.md).

Abuse reports + vulnerability disclosure: **`gatekeeper@vitron.ai`**.

---

## License

MIT — see [LICENSE](./LICENSE). Covers **this MCP bridge only.**

## Patent Notice

The Alethia runtime is patent pending (U.S. Application No. 19/571,437). The MIT license on this bridge does **not** grant any patent license. For licensing inquiries: **gatekeeper@vitron.ai**.
