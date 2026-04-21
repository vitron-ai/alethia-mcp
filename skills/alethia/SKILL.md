---
name: alethia
description: Drive a real browser with plain English via Alethia — the patent-pending zero-IPC agent-driven testing runtime. Use when the user asks to smoke-test a local app, run an accessibility (WCAG) or security (NIST SP 800-53) audit, prove the EA1 safety gate works, bootstrap test coverage on an unknown page, run parallel multi-page checks, or export a cryptographically signed evidence pack. Requires the @vitronai/alethia MCP server to be configured. Trigger patterns include "test this page," "verify the login flow," "audit accessibility," "compliance audit," "run WCAG/NIST," "check that deletes are blocked," and similar.
---

# Alethia — agent-driven browser testing

Alethia is built **for AI agents**, not human test authors. You drive it in plain English. You almost never need to write a selector — say *"click Submit"* and Alethia finds the right button. Say *"verify the dashboard is visible"* and it checks. Say *"type admin@example.com into the email field"* and it types.

The runtime is local-only: it refuses to navigate to anything outside `file://`, `localhost`, `127.0.0.1`, `.local`, or RFC1918 ranges. Destructive actions (delete, purchase, transfer, submit, liquidate, purge) are blocked by default under the VITRON-EA1 policy gate — not a safety feature you can turn off, a compile-time constant.

## Bootstrap: if the `alethia_*` tools aren't available yet

**Before trying to use any tool in this skill, confirm it's actually available.** If `alethia_tell` and friends are missing from your tool list, the user hasn't finished installing Alethia. Don't guess, don't hallucinate results — walk them through setup first.

Tell the user, verbatim:

> Alethia isn't set up in this Claude Code session yet. Two steps to install:
>
> **1. Install the bridge** (one-time):
> ```
> npm install -g @vitronai/alethia
> ```
>
> **2. Add to your MCP config** at `~/.claude/mcp.json` (create the file if it doesn't exist):
> ```json
> {
>   "mcpServers": {
>     "alethia": {
>       "command": "alethia-mcp"
>     }
>   }
> }
> ```
>
> Then restart Claude Code. The signed headless runtime downloads automatically on first use (~100 MB, Ed25519-verified from GitHub Releases). No signup, no telemetry.

After the user confirms they've completed those steps and restarted, the `alethia_*` tools will be in your next session's tool list. Retry the user's original request then.

## When to use this skill

- **"Smoke test this page"** → `alethia_tell` with navigate + asserts
- **"Audit this page for accessibility"** → `alethia_audit_wcag`
- **"Audit for compliance / security"** → `alethia_audit_nist`
- **"Generate tests for a page I haven't covered yet"** → `alethia_propose_tests`
- **"Prove the EA1 gate blocks destructive actions here"** → `alethia_assert_safety`
- **"Run these tests in parallel across multiple pages"** → `alethia_tell_parallel`
- **"Export a signed evidence pack of what you just did"** → `alethia_export_session`
- **"Take a screenshot"** → `alethia_screenshot`
- **"Watch it happen live"** → `alethia_show_cockpit`

## How to drive Alethia in NLP

The compiler maps plain English to action IR. Speak to it like a human tester:

```
navigate to http://localhost:3000
assert Dashboard is visible
click Sign In
type admin@example.com into the email field
type hunter2 into the password field
click Log in
assert Welcome back! is visible
wait 200 milliseconds
```

Each line becomes one step. The `:text(...)` resolver finds elements by textContent, `aria-label`, `placeholder`, or input value — with tight-match ranking that prefers interactive elements and smaller own-text over wrapper containers.

## The `expect block:` primitive — unique to Alethia

For destructive actions, **do NOT bypass the gate**. Assert that the gate correctly refuses the action:

```
navigate to http://localhost:3000/admin
expect block: click Delete All Users
expect block: click Purge Audit Log
expect block: click Transfer Funds
```

Each step **passes** if the gate blocked the action (reason code `DENY_WRITE_HIGH`) and **fails** if the action went through. This is how you prove safety — not by avoiding destructive controls, but by exercising them and confirming the gate holds.

## Common tool-chain patterns

### Quick smoke
```
alethia_tell({ instructions: "navigate to http://localhost:3000\nassert the page is visible" })
```

### Bootstrap tests on an unknown page
```
1. alethia_propose_tests({ url })  → returns candidate NLP blocks, including
                                     an auto-generated EA1 Safety Gate Verification
                                     block with expect-block: lines for every
                                     destructive action discovered on the page
2. alethia_tell({ instructions: <each block> })
```

### Full compliance audit with signed evidence
```
1. alethia_tell({ instructions: "navigate to <url>" })
2. alethia_audit_wcag()   → 14 accessibility criteria
3. alethia_audit_nist()   → 8 NIST SP 800-53 controls
4. alethia_export_session() → signed JSON evidence pack, SHA-256 hashed
```

### Prove the EA1 gate works on a real page
```
alethia_assert_safety({ url })  → walks every destructive control on the
                                   page, attempts each, reports per-action
                                   block/allow status. Any blocked:false
                                   row is a safety regression.
```

### Live demo (cockpit-visible)
```
1. alethia_show_cockpit()       → pop the oversight window
2. alethia_serve_demo()         → start the bundled demo server
3. alethia_tell({ instructions: "navigate to <demo_url>\n..." })
4. alethia_export_session()
```

## NLP patterns that work well

- **Assertions:** *"assert X is visible"*, *"assert X exists"*, *"assert X is not visible"*
- **Text input:** *"type X into the Y field"*, *"type X into the input"*
- **Clicks:** *"click Submit"*, *"click the Sign In button"*
- **Navigation:** *"navigate to <url>"* (must be a local origin)
- **Waits:** *"wait 200 milliseconds"*, *"wait 1 second"*
- **Conditional:** *"if cookie banner exists, click Accept"* — the step gracefully skips if the element isn't there

## NLP patterns that trip the resolver

- Two controls with the same visible label. Scope it: *"click Delete in row 3"* instead of *"click Delete"*.
- Empty icon-only buttons with no `aria-label`. The `:text()` path can't find them. Use `alethia_eval` for a last-resort CSS selector.
- Assertions that include a descriptor word: *"assert the Welcome heading is visible"* may over-match. Prefer the exact text: *"assert Welcome back! is visible"*.

## When smart assertions fail

On any `alethia_tell` failure, the response includes:

- `nearMatches` — elements on the page whose text resembles the target
- `suggestedFix` — corrected NLP you can re-run
- `pageContext` — buttons, headings, inputs currently on the page

Read these before retrying. Most failures are phrasing mismatches, not real bugs — the suggested fix usually works.

## Escape hatches (use sparingly)

- **`alethia_eval({ expression })`** — raw JavaScript in the page context. For cases where NLP can't express what you need (counting elements, reading computed styles, triggering React's native input setter). Runs in the target page, not the host.
- **`alethia_screenshot()`** — PNG of the current page, for visual verification.
- **`alethia_activate_kill_switch` / `alethia_reset_kill_switch`** — emergency halt and resume. Blocks all tool calls until reset.

## Don't

- **Don't write CSS selectors in NLP.** Say *"click Submit"*, not *"click button#submit"*. The resolver handles mapping.
- **Don't try to bypass the EA1 gate.** If a destructive action needs to actually run (e.g., cleanup in a test teardown on a throwaway DB), that's a custom-signed-build conversation with vitron.ai, not something the default runtime allows.
- **Don't expect telemetry or cloud state.** Every run is local and ephemeral unless you call `alethia_export_session`, which produces a signed artifact you save yourself.

## At session end for compliance-sensitive work

Always call `alethia_export_session()`. Returns:

- Every tool call made this session (inputs, outputs, timestamps)
- Every policy decision (allow/block + reason code)
- A SHA-256 integrity hash over the canonical payload
- Enough detail for chain-of-custody review

Tell the user the returned hash so they can record it alongside the artifact.
