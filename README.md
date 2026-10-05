# Alethia MCP

## AI agents can write software. Vitron makes sure it works.

Vitron is building execution and verification infrastructure for AI-powered software development. Alethia connects an AI agent to an application so it can run workflows, check behavior, inspect results, and iterate with evidence.

Alethia is available to MCP-compatible clients as a local server. Give your agent plain-English instructions such as “open the sign-in page, submit the test account, and confirm the dashboard appears.” The agent receives step results and can continue based on what happened.

[![npm version](https://img.shields.io/npm/v/@vitronai/alethia.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/@vitronai/alethia)
[![Bridge license: MIT](https://img.shields.io/badge/bridge-MIT-green.svg?logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![Source](https://img.shields.io/badge/source-GitHub-1f2328.svg?logo=github&logoColor=white)](https://github.com/vitron-ai/alethia-mcp)

## Get started

### Install for Claude Code

The Claude Code plugin installs the MCP server and its workflow skill:

~~~text
/plugin marketplace add vitron-ai/alethia-mcp
/plugin install alethia@vitronai
~~~

Restart Claude Code or run `/reload-plugins`.

To install only the skill, use `alethia-mcp --install-skill` after installing the package, or follow the [manual skill instructions](https://github.com/vitron-ai/alethia-mcp/tree/main/skills/alethia).

### Install for another MCP client

Alethia requires Node.js 18 or later. Install the bridge:

~~~sh
npm install -g @vitronai/alethia
~~~

Add it to your MCP client's configuration:

~~~json
{
  "mcpServers": {
    "alethia": {
      "command": "alethia-mcp"
    }
  }
}
~~~

For a temporary or always-current install, configure the client to run npm's package binary:

~~~json
{
  "mcpServers": {
    "alethia": {
      "command": "npx",
      "args": ["-y", "@vitronai/alethia@latest"]
    }
  }
}
~~~

The bridge checks for compatible updates in the background unless `ALETHIA_SKIP_AUTO_UPDATE=1`. The `@latest` npx configuration resolves the latest published bridge when the client starts and may take longer on a cold cache.

Common client configuration locations:

| Client | Configuration |
|---|---|
| Claude Code | `~/.claude/mcp.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Cursor | Settings → MCP |
| Other clients | The client's MCP server configuration |

Restart the client after changing its configuration. The proprietary runtime downloads on first use and is verified before it is installed. By default, the cockpit is visible while the agent works. Set `ALETHIA_HEADLESS=1` to hide it; CI environments are detected automatically.

## What your agent can do

Ask for an outcome; your agent selects and combines the tools.

| Tool | Purpose |
|---|---|
| `alethia_tell` | Run newline-separated, plain-English instructions and return per-step results. |
| `alethia_compile` | Preview how instructions compile without executing them. |
| `alethia_propose_tests` | Inspect a page and suggest candidate test flows. |
| `alethia_assert_safety` | Check how the runtime's safety policy handles destructive actions on a page. |
| `alethia_audit_wcag` | Run an axe-core accessibility audit against WCAG 2.1 AA rules. |
| `alethia_audit_nist` | Check a page against selected NIST SP 800-53 Rev. 5 controls. |
| `alethia_export_session` | Export session records with SHA-256 integrity data. |
| `alethia_tell_parallel` | Run flows concurrently against multiple URLs. |
| `alethia_screenshot`, `alethia_eval` | Capture the current page or evaluate a JavaScript expression in that page. |
| `alethia_status`, `alethia_activate_kill_switch` | Check runtime status or halt automation. |
| `alethia_serve_demo` | Serve a built-in demo page on localhost. |
| `alethia_show_cockpit`, `alethia_hide_cockpit` | Show or hide the runtime's oversight window. |

Accessibility and NIST audit tools require a valid runtime license. Some runtime builds include a bundled, time-limited trial for these tools; its expiry comes from the license issue date, so it may have expired before you download the build. Contact Vitron for current access.

The parallel tool supports up to two concurrent flows by default; a valid license can raise the limit to ten.

Sensitive inputs are blocked by default. The optional `allowSensitiveInput: true` setting is for legitimate authentication or payment tests.

Audit results are technical findings, not a certification or a claim of compliance.

Example prompts:

- “Run a smoke test on my local app and confirm the checkout confirmation appears.”
- “Preview these test instructions before running them.”
- “Audit this page for accessibility issues and summarize findings by impact.”
- “Check this admin page for destructive controls and report how the safety policy responds.”
- “Export the session evidence when the checks are complete.”

For complete prompts and workflows, see the [agent cookbook](./docs/agent-cookbook.md).

## Use Alethia in a project or CI

No project-local package is required. Configure the MCP server once, then ask your agent to create a `.alethia` file in your repository and run it.

~~~text
# tests/e2e/login.alethia
name login flow
navigate to http://localhost:5173
assert "Sign in" is visible
click Sign in
assert dashboard is visible
~~~

To run the file directly from a shell or CI job:

~~~sh
alethia run tests/e2e/login.alethia
~~~

The command exits with code 0 when all steps pass, 1 when a run fails, and 2 for invalid input. You can also pipe a test file into stdin:

~~~sh
cat tests/e2e/login.alethia | alethia run -
~~~

On Windows, use a file or stdin for multi-step runs. npm command shims may truncate real newlines passed as an argument. For a short inline test, separate steps with literal `\n`:

~~~sh
alethia run --nlp "navigate to http://localhost:5173\\nassert the page loaded"
~~~

PowerShell stdin example:

~~~powershell
Get-Content tests\e2e\login.alethia -Raw | alethia run -
~~~

More CI guidance is in [examples/github-actions.yml](./examples/github-actions.yml); project examples are in [examples](./examples).

## Product and licensing

The npm package in this repository is the **MIT-licensed MCP bridge**. It is open source and does not contain the Alethia execution runtime.

The **Alethia runtime is proprietary and closed source**. The bridge downloads it separately from [Alethia releases](https://github.com/vitron-ai/alethia/releases). Using this bridge does not grant rights to the runtime beyond the applicable runtime license. Review the [runtime evaluation terms](https://github.com/vitron-ai/alethia/blob/main/EVAL_LICENSE.md). Use beyond evaluation—including production or customer-facing use, non-local origins, or third-party reliance on generated audits or evidence—requires a separate written commercial license. Contact [team@vitron.ai](mailto:team@vitron.ai).

The **Themis project is open source** and is a separate testing and verdict layer: [vitron-ai/themis](https://github.com/vitron-ai/themis). Themis does not include or open-source the Alethia runtime.

## Configuration

These environment variables are optional:

| Variable | Default | Purpose |
|---|---|---|
| `ALETHIA_HEADLESS` | unset | Set to `1` to hide the cockpit. |
| `ALETHIA_HIGHLIGHTS` | enabled for `tell` | Set to `0` to disable per-step highlights. |
| `ALETHIA_RUNTIME_VERSION` | latest release | Pin the runtime version. |
| `ALETHIA_RUNTIME_DIR` | `~/.alethia/runtime` | Set the runtime install directory. |
| `ALETHIA_TIMEOUT_MS` | `60000` | Set the per-request timeout in milliseconds. |
| `ALETHIA_DEBUG` | unset | Set to `1` for bridge diagnostics on stderr. |
| `ALETHIA_SKIP_AUTO_UPDATE` | unset | Set to `1` to disable bridge self-updates. |
| `ALETHIA_BRIDGE_VERSION` | latest compatible version | Pin the bridge version and skip its registry update check. |
| `ALETHIA_BRIDGE_SRI` | unset | Require a matching SHA-512 integrity value for an auto-updated bridge. |
| `ALETHIA_HOST` / `ALETHIA_PORT` | `127.0.0.1` / `47432` | Configure the local runtime endpoint. |

The runtime and bridge version pins are useful for reproducible CI runs. Bridge updates do not automatically cross major-version boundaries.

## Troubleshooting

**The client does not show Alethia tools.** Check the MCP configuration, restart the client, and run `alethia-mcp --health-check`. Set `ALETHIA_DEBUG=1` to print bridge diagnostics to stderr.

**The runtime is missing or cannot start.** Run `alethia-mcp --health-check` to check availability. On first use, the runtime must be downloaded from GitHub Releases. Check network access and review any verification or extraction error printed by the bridge.

**A multi-step inline run loses later steps on Windows.** Use a `.alethia` file or pipe it to `alethia run -`. Literal `\n` separators also work for short inline input.

**A page cannot be reached.** Allowed destinations are set by the runtime build. A license file does not add origins. Contact Vitron if you need a different deployment scope.

**A destructive action is blocked.** Review the policy result and test against an application and data you control. Do not try to bypass a safety decision through a different prompt.

**A licensed audit feature is unavailable.** Audit access requires a valid runtime license. Contact [team@vitron.ai](mailto:team@vitron.ai) for licensing help.

## Learn more

- [Agent cookbook](./docs/agent-cookbook.md)
- [UI patterns for agent-driven testing](./docs/ui-for-agents.md)
- [Security policy](./SECURITY.md)
- [CI example](./examples/github-actions.yml)
- [Vitron](https://vitron.ai)
- [Alethia runtime releases](https://github.com/vitron-ai/alethia/releases)
- [Themis open-source repository](https://github.com/vitron-ai/themis)
- [Report a bug](https://github.com/vitron-ai/alethia-mcp/issues)

The runtime is proprietary software and patent pending. This repository contains the MIT-licensed MCP bridge. The MIT license does not grant a license to the runtime or any patent rights.
