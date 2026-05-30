---
description: Run a full WCAG + NIST compliance audit with signed evidence pack
allowed-tools: mcp__alethia__alethia_tell, mcp__alethia__alethia_audit_wcag, mcp__alethia__alethia_audit_nist, mcp__alethia__alethia_export_session
---

Run a full Alethia compliance audit against the local dev server.

Steps:
1. Call `alethia_tell` to navigate to `http://localhost:3000` and assert the page loaded.
2. Call `alethia_audit_wcag` and `alethia_audit_nist` in parallel.
3. Call `alethia_export_session` and report the SHA-256 evidence hash to the user.

If the dev server runs on a different port, ask the user before proceeding.
Report all WCAG violations and NIST findings clearly, grouped by severity.
