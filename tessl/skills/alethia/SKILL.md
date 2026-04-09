---
name: alethia
description: Use when the user asks to run E2E tests, verify a web page, check if a UI element is visible, fill out a form, or drive a browser with natural language. Returns per-step results with safety classifications, policy decisions, and a signed audit trail.
---

# Alethia Skill

Use when:

- the user asks to run an E2E test or verify a web application
- the user asks to check if something is visible on a page
- the user asks to fill out a form and verify the result
- the user asks to drive a browser with natural language
- the user mentions trigger terms like "E2E test", "browser test", "verify the page", "assert visible", "navigate to localhost"

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

## Primary Workflow

1. Call `alethia_status` to verify the runtime is healthy and the kill switch is inactive.
2. Call `alethia_compile` to preview the Action IR before executing — catch NLP issues early.
3. Call `alethia_tell` with newline-separated plain-English instructions.
4. Read the PlanRun result: check `run.ok`, inspect per-step `stepRuns`, review `policyAudits`.
5. If a step was blocked with `DENY_WRITE_HIGH`, explain the EA1 safety classification to the user.
6. If a step failed, read the `detail` field for the error message and adjust the NLP.

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

**Assertions (avoid — descriptor words get included in text search):**
```
assert the heading Login is visible    → searches for "heading Login", not "Login"
assert the button Sign In exists       → searches for "button Sign In"
```

**Typing into fields:**
```
type admin@example.com into the email field
type password123 into the password field
```

**Clicking:**
```
click Sign In
click the Reset button
```

**Waiting:**
```
wait 500 milliseconds
```

## Understanding the PlanRun Response

Each `alethia_tell` call returns a PlanRun with:

- `run.ok` — `true` if all steps passed, `false` if any step failed or was blocked
- `run.elapsedMs` — total wall clock time for the entire flow
- `run.stepRuns[]` — per-step results with `ok`, `attempts`, `elapsedMs`, `detail`, `safetyClass`, `policyDecision`, `reasonCode`
- `run.policyAudits[]` — per-step EA1 audit records with `timestamp`, `decision`, `reasonCode`, `policyProfile`
- `run.integrity.payloadHash` — SHA-256 hash of the canonical PlanRun (tamper detection)

## Safety Classifications

| Class | Examples | Default policy |
|---|---|---|
| `read` | navigate, assert, wait | always allowed |
| `write-low` | type into field, set value | allowed by default |
| `write-high` | click Submit, click Delete, click Purchase | **blocked by default** |

When a step is blocked with `DENY_WRITE_HIGH`, this is correct behavior — the EA1 policy gate is protecting the user from unintended destructive actions. Explain this to the user rather than trying to work around it.

## Known Limitations

- **http://localhost navigation**: same-origin policy blocks iframe `contentDocument` access across `file://` and `http://` origins. Use `file://` URLs for test fixtures. Localhost support is in progress.
- **NLP descriptor words**: phrases like "the heading X" include "heading" in the text search needle. Use "assert X is visible" instead.
