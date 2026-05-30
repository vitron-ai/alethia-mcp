---
description: Run a fixed assertion suite against a URL — fail on any regression
allowed-tools: mcp__alethia__alethia_tell, mcp__alethia__alethia_export_session
---

Run a regression check against the app using a fixed set of assertions.

Ask the user for:
1. The URL to test (default: `http://localhost:3000`)
2. The list of assertions to verify (e.g. "assert Login is visible", "assert the signup button is present")

Call `alethia_tell` with:
```
navigate to <url>
<assertion 1>
<assertion 2>
...
```

If all assertions pass, call `alethia_export_session` and report the evidence hash — save it as the new baseline. If any assertion fails, report it as a regression and stop.
