---
description: Scan a page with alethia_propose_tests then run each suggested block
allowed-tools: mcp__alethia__alethia_propose_tests, mcp__alethia__alethia_tell
---

Bootstrap a test suite for the local dev server by scanning the page and running suggested test blocks.

1. Call `alethia_propose_tests` with the URL (default: `http://localhost:3000`) to get candidate NLP test blocks.
2. For each block returned, call `alethia_tell` with that block's instructions — run them one at a time (browser state is shared; do not run in parallel).
3. Report pass/fail for each block by name.

Ask the user for the URL if the app doesn't run on port 3000.
