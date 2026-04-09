# Automate E2E Testing for a Product Onboarding Flow

## Problem/Feature Description

The QA team at Stackfield recently integrated Alethia into their CI pipeline to run browser-based E2E tests. A new engineer joined the team and needs to document the exact sequence of MCP tool calls required to correctly run an E2E test flow, so the team can use it as a reference and onboarding guide.

The onboarding page under test lives at `file:///workspace/fixtures/onboarding.html` and consists of a welcome message, a "Get Started" button that reveals a setup form, a name field, and a "Continue" button.

Your job is to write a reference automation script documenting the correct sequence of Alethia tool calls to test this page, along with a clear log of what each call returns and how to interpret the results. The script and log should together demonstrate the full recommended workflow for running an alethia test.

## Output Specification

Produce the following files:

- `test_plan.md` — A step-by-step walkthrough describing which Alethia MCP tools to call and in what order, with example inputs and expected output fields to check. Include: the purpose of each call, the parameters you would pass, and which fields in the response you would inspect.
- `test_script.json` — A JSON document representing the tool calls in sequence:
  ```json
  {
    "steps": [
      { "tool": "<tool_name>", "params": { ... }, "purpose": "<why this call>" },
      ...
    ]
  }
  ```

The test_script.json should cover: a health check step, a preview/compilation step, and the actual execution step for the onboarding flow described above.
