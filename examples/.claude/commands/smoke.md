---
description: Quick Alethia smoke test — navigate and assert the page loads
allowed-tools: mcp__alethia__alethia_tell, mcp__alethia__alethia_screenshot
---

Run a quick Alethia smoke test against the local dev server.

Call `alethia_tell` with:
```
navigate to http://localhost:3000
assert the page is visible
```

If the page loads, call `alethia_screenshot` and show the result to the user.
If it fails, report the step error and `nearMatches` from the response.

Ask the user for the URL if the app doesn't run on port 3000.
