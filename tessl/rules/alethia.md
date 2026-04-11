# Rules: alethia

## Always

- Use `alethia_status` before running tests to verify the runtime is healthy and the kill switch is inactive.
- Use `alethia_compile` to preview Action IR before running expensive test flows — catch NLP compilation issues early.
- Respect `DENY_WRITE_HIGH` policy blocks. They are a safety feature, not a bug. Explain to the user why the action was blocked.
- Include a `name` parameter in `alethia_tell` calls for audit trail clarity.

## Never

- Do not try to bypass the EA1 policy gate. If an action is blocked, explain the safety classification to the user.
- Do not pass `allowSensitiveInput: true` unless the user explicitly asks to test an auth or payment flow.
- Both `file://` and `http://localhost` URLs are supported. Use whichever fits the test scenario.

## Phrasing tips

- For assertions, use "assert X is visible" not "assert the heading X is visible" — descriptor words get included in the text search.
- For typing, use "type VALUE into the FIELD field" — the NLP compiler handles this pattern well.
- For clicks, use "click LABEL" — keep it simple.
- Separate instructions with newlines, not periods or semicolons.
