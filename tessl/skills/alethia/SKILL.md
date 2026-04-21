---
name: alethia
description: Use when the user asks to run E2E tests, verify a web page, generate tests for an app, prove destructive actions are blocked, check if a UI element is visible, fill out a form, or drive a browser with natural language. Returns per-step results with safety classifications, policy decisions, DOM diffs, structured page context, and a signed audit trail.
---

# Alethia Skill

Use when:

- the user asks to run an E2E test or verify a web application
- the user asks to **generate tests for a URL or app** (use `alethia_propose_tests`)
- the user asks to **verify that destructive actions are blocked** or run a compliance check (use `alethia_assert_safety`)
- the user asks to check if something is visible on a page
- the user asks to fill out a form and verify the result
- the user asks to drive a browser with natural language
- the user mentions trigger terms like "E2E test", "browser test", "verify the page", "assert visible", "navigate to localhost", "audit this page for safety", "write tests for this app"

For deeper references:

- [Tile Overview](../../docs/index.md)
- [Rules](../../rules/alethia.md)

## Prerequisites

The `alethia-mcp` MCP server must be configured in your agent's MCP config:

```json
{
  "mcpServers": {
    "alethia": { "command": "alethia-mcp" }
  }
}
```

If not installed: `npm install -g @vitronai/alethia`. The bridge auto-installs the signed headless runtime on first use.

## Primary Workflows

### A. "Test this page/app" — agent-generated coverage

1. Call `alethia_status` to verify the runtime is healthy and the kill switch is inactive.
2. Call `alethia_propose_tests` with the target URL. Returns a `tests: string[]` of ready-to-run NLP test blocks plus a `summary` of what was discovered (headings, buttons, inputs, destructive actions).
3. For each test block, call `alethia_tell` with the block as input.
4. Read the PlanRun result: check `run.ok`, inspect per-step `stepRuns`.
5. If any step fails, read the top-level `nearMatches` / `suggestedFix` / `pageContext` fields — they're structured JSON, not prose. Use `suggestedFix` to retry the step.

### B. "Verify safety" — automated policy proof

1. Call `alethia_assert_safety` with the target URL (and optional `profile`).
2. Returns `{ passed, totalDestructive, blocked, results: [{action, blocked, detail}] }`.
3. `passed: true` means every destructive action on the page was denied by the EA1 policy gate — that's the compliance proof the user asked for.
4. If any action was NOT blocked (`passed: false`), surface it prominently; the safety gate has a gap and the user needs to know.

### C. "Run this specific test" — direct NLP

1. Call `alethia_status` for liveness.
2. Optional: call `alethia_compile_nlp` to preview the Action IR.
3. Call `alethia_tell` with newline-separated plain-English instructions.
4. Read the PlanRun; on failure use the structured response fields for self-repair.

## NLP Phrasing Guide

**Navigation:**
```
navigate to file:///path/to/page.html
navigate to http://localhost:3000/login
```

**Assertions (use these phrasings):**
```
assert Login is visible
assert Welcome to Dashboard is visible
assert Sign In button is visible
```

**Verifiable safety — `expect block:` (unique to Alethia):**
```
expect block: click Delete
expect block: click Liquidate All
```
The step **passes** if the EA1 gate blocks it, **fails** if the gate lets it through. Use this to prove your app's safety boundary works. This is the primitive that makes Alethia a verifiable-safety framework, not just a test runner.

**Typing into fields:**
```
type admin@example.com into the email field
type hello world into the message field
```

**Never include real passwords, tokens, or secrets in NLP instructions.** They flow through the agent's context and conversation history. The runtime blocks sensitive input fields (password, credit card, SSN) by default — use `allowSensitiveInput: true` with dummy test credentials only.

**Clicking:**
```
click Sign In
click the Reset button
click #specific-element-id
```

**Waiting:**
```
wait 500 milliseconds
```

## Structured Response Fields

Every `alethia_tell` response returns top-level structured fields for agent self-repair — don't regex-parse prose:

- `nearMatches: string[]` — elements close to the failed selector
- `suggestedFix: string | null` — corrected selector/NLP the agent can retry with
- `pageContext: { title, headings, buttons, inputs } | null` — structured page state

Use these when a step fails: pick from `nearMatches`, apply `suggestedFix`, retry.

## Understanding the PlanRun Response

Each `alethia_tell` call returns a PlanRun with:

- `run.ok` — `true` if all steps passed, `false` if any step failed or was blocked
- `run.elapsedMs` — total wall clock time for the entire flow
- `run.stepRuns[]` — per-step results with `ok`, `attempts`, `elapsedMs`, `detail`, `safetyClass`, `policyDecision`, `reasonCode`, plus a `snapshot` (per-step PNG) when `capture: true`
- `run.policyAudits[]` — per-step EA1 audit records with `timestamp`, `decision`, `reasonCode`, `policyProfile`
- `run.integrity.payloadHash` — SHA-256 hash of the canonical PlanRun (tamper detection)
- Top-level: `nearMatches`, `suggestedFix`, `pageContext` (see above)

## Safety Classifications

| Class | Examples | Default policy |
|---|---|---|
| `read` | navigate, assert, wait | always allowed |
| `write-low` | type into field, set value | allowed by default |
| `write-high` | click Submit, click Delete, click Purchase | **blocked by default** |

When a step is blocked with `DENY_WRITE_HIGH`, this is correct behavior — the EA1 policy gate is protecting the user from unintended destructive actions. Explain this to the user rather than trying to work around it.

When the user explicitly asks to **verify** that destructive actions are blocked (compliance, safety review), use `expect block:` in NLP or call `alethia_assert_safety`. A blocked step in `expect block:` mode counts as a PASS.

## Reason Codes

Common `reasonCode` values on step results:

- `ALLOW` — step executed normally
- `DENY_WRITE_HIGH` — write-high action blocked by policy (correct behavior)
- `DENY_SENSITIVE_INPUT` — password/token/card input blocked
- `KILL_SWITCH_ACTIVE` — runtime halted by operator
- `EXPECT_BLOCK_VIOLATED` — `expect block:` step was NOT blocked (policy gate failure — hard fail)

## Known Limitations

- **NLP descriptor words**: phrases like "the heading X" include "heading" in the text search needle. Use "assert X is visible" instead — the element resolver prefers interactive elements and headings automatically.
- **Per-step screenshots**: the filmstrip `capture: true` mode is supported for NLP that includes `navigate to`. For no-navigate runs, a single end-of-run screenshot is captured.
