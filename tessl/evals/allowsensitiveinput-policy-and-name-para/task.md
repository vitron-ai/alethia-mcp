# E2E Test Plan for a User Registration Flow

## Problem/Feature Description

Holloway Health is building a new patient registration portal. The QA team wants automated E2E tests that exercise the full sign-up form at `file:///workspace/holloway/register.html`. The form includes standard fields (full name, email address) as well as a password field and a payment method section with a credit card number field.

The tech lead wants the tests to be ready for two separate scenarios:
1. **Smoke test** — only verifies the registration page loads and the form structure is correct (no sensitive data entered)
2. **Auth flow test** — explicitly requested by the QA lead for validating the password field behavior, which requires typing into the password input

Produce a complete test script for each scenario. The tests will be reviewed by a compliance officer, so each test call should be clearly identifiable in the audit trail.

## Output Specification

Produce the following files:

- `smoke_test_script.json` — A JSON document representing the tool calls for the smoke test, in the format:
  ```json
  {
    "steps": [
      { "tool": "<tool_name>", "params": { ... }, "purpose": "<why>" },
      ...
    ]
  }
  ```

- `auth_flow_script.json` — A JSON document representing the tool calls for the auth flow test (which includes typing into the password field), in the same format.

- `decisions.md` — A brief document explaining the key parameter choices made between the two test scripts and why they differ.
