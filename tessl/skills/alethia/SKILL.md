# Skill: alethia

Use Alethia to run E2E tests against web applications using natural language. Alethia drives a real browser in-process with zero IPC — ~45x faster than Playwright.

## When to use

- The user asks you to test, verify, or check a web application
- The user wants to assert something is visible on a page
- The user wants to fill out a form and verify the result
- The user wants to run an E2E test flow against localhost

## Prerequisites

The `alethia-mcp` MCP server must be configured. The bridge auto-installs the headless runtime on first use.

## How to use

Call `alethia_tell` with natural-language instructions:

```
Use alethia_tell with:
  nlp: "navigate to http://localhost:3000
        assert the login form is visible
        type test@example.com into the email field
        type password123 into the password field
        click Sign In
        assert the dashboard is visible"
  name: "login-flow-test"
```

## What you get back

A PlanRun containing:
- Per-step results (ok/failed, elapsed time, retry attempts)
- Safety classifications (read, write-low, write-high)
- Policy decisions (allow/block with reason codes)
- Audit records with timestamps
- SHA-256 integrity hash

## Important notes

- **write-high actions are blocked by default.** Clicking buttons labeled "Submit", "Delete", "Purchase" etc. will be blocked under the default `controlled-web` profile. This is the EA1 safety gate working correctly.
- **Use "assert X is visible"** not "assert the heading X is visible" — the NLP compiler may include descriptor words like "heading" in the text search needle.
- **file:// URLs work.** Use `navigate to file:///path/to/file.html` for local fixtures.
- **http://localhost is not yet supported** for navigation (same-origin limitation). Use file:// URLs for now.
