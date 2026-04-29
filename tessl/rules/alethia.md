# Rules: alethia

## Always

- Use `alethia_status` before running tests to verify the runtime is healthy and the kill switch is inactive.
- Use `alethia_compile` to preview Action IR before running expensive test flows — catch NLP compilation issues early.
- Respect `DENY_WRITE_HIGH` policy blocks. They are a safety feature, not a bug. Explain to the user why the action was blocked.
- Include a `name` parameter in `alethia_tell` calls for audit trail clarity.
- When a step fails, read the top-level `nearMatches`, `suggestedFix`, and `pageContext` fields — they are structured JSON, not prose. Use them for self-repair instead of regex-parsing the `detail` string.
- When the user asks to generate tests for a page or app, call `alethia_propose_tests` first — returns a ready-to-run NLP suite, don't hand-write from scratch.
- When the user asks to verify safety/compliance, call `alethia_assert_safety` — it walks every destructive action on the page and proves the EA1 gate blocks each one.
- When writing NLP that tests a destructive action's safety, use `expect block: <action>` — a blocked step then counts as a PASS, and an allowed step counts as a FAIL. This is the policy-verification primitive.

## Never

- Do not try to bypass the EA1 policy gate. If an action is blocked, explain the safety classification to the user.
- Do not pass `allowSensitiveInput: true` unless the user explicitly asks to test an auth or payment flow.
- Do not invent selectors or NLP phrasings the response didn't support — if `nearMatches` is empty and the selector is not found, tell the user the element is not on the page rather than guessing.
- Both `file://` and `http://localhost` URLs are supported. Use whichever fits the test scenario.
- Do not attempt to navigate to non-local origins (anything outside `file://`, `localhost`, `127.0.0.1`, `.local`, RFC1918 ranges). The runtime will return a structured `NON_LOCAL_ORIGIN` block — this is enforced at the binary level and is not configurable. If the user needs to test a production origin, direct them to **gatekeeper@vitron.ai** for a design-partner build; do not suggest flags, env vars, or workarounds because none exist.

## Phrasing tips

- For assertions, use "assert X is visible" not "assert the heading X is visible" — descriptor words get included in the text search.
- For typing, use "type VALUE into the FIELD field" — the NLP compiler handles this pattern well.
- For clicks, use "click LABEL" or "click #id-selector" — keep it simple.
- For policy verification, use "expect block: click LABEL" — the step passes if EA1 blocks it.
- Separate instructions with newlines, not periods or semicolons.
