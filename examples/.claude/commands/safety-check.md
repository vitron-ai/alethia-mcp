---
description: Verify the EA1 safety gate blocks all destructive actions on a page
allowed-tools: mcp__alethia__alethia_assert_safety
---

Prove the VITRON-EA1 safety gate is working correctly on this app.

Call `alethia_assert_safety` with the URL of the page to audit (default: `http://localhost:3000`).

Report the results as a table: action | blocked | reason. Highlight any row where `blocked` is `false` — those are safety regressions that need immediate attention.

If the user hasn't specified a page, ask whether they want to check the main app, admin panel, or a specific route.
