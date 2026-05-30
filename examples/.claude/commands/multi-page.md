---
description: Smoke test multiple pages in parallel using alethia_tell_parallel
allowed-tools: mcp__alethia__alethia_tell_parallel
---

Smoke test multiple pages in parallel using alethia_tell_parallel.

Ask the user for the list of pages to test. Each page needs a URL and an optional plain-English assertion.

Build a `specs` array — omit assertions for navigate-only pages:
```json
[
  { "url": "http://localhost:3000", "instructions": "navigate to http://localhost:3000", "name": "home" },
  { "url": "http://localhost:3000/about", "instructions": "navigate to http://localhost:3000/about\nassert About is visible", "name": "about" }
]
```

Call `alethia_tell_parallel` with that specs array. Report per-page pass/fail and total elapsed time.
