# Examples

Copy-paste integration examples for adding Alethia to your project.

## Claude Code commands

The `.claude/commands/` folder contains project-level slash commands for Claude Code. Copy any of these into your own project's `.claude/commands/` directory and they'll appear as `/command-name` in Claude Code when that project is open.

| Command | What it does |
|---------|-------------|
| `/smoke` | Quick navigate + assert the page loaded |
| `/audit` | Full WCAG + NIST compliance audit → signed evidence pack |
| `/safety-check` | Prove the EA1 gate blocks every destructive action on a page |
| `/bootstrap` | Scan a page with `propose_tests` and run each suggested block |
| `/multi-page` | Smoke test multiple pages in parallel |
| `/regression` | Run a fixed assertion suite — fail on any regression |

**Install:**
```bash
# From the root of your project:
mkdir -p .claude/commands
curl -O --output-dir .claude/commands \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/commands/smoke.md \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/commands/audit.md \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/commands/safety-check.md \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/commands/bootstrap.md \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/commands/multi-page.md \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/commands/regression.md
```

Or just copy the files manually. They're plain Markdown — edit the default URL or port to match your stack.

## Claude Code workflows

The `.claude/workflows/` folder contains named workflow scripts for the Claude Code `Workflow()` tool. Copy any of these into your own project's `.claude/workflows/` directory and Claude Code can run them with `Workflow({ name: "alethia:<name>" })` or via the `/workflows` panel.

| Workflow | What it does |
|----------|-------------|
| `alethia:smoke` | Navigate to a URL and assert the page loads |
| `alethia:full-audit` | WCAG + NIST audits in parallel → signed evidence pack |
| `alethia:safety-gate` | EA1 per-action block/allow report |
| `alethia:bootstrap` | `propose_tests` → run each block sequentially |
| `alethia:multi-page` | Smoke test multiple pages in parallel via `alethia_tell_parallel` |
| `alethia:regression` | Fixed assertion suite — returns pass/fail + evidence hash |

All workflows accept a `url` arg (default: `http://localhost:3000`). See each file's header comment for the full args schema.

**Install:**
```bash
# From the root of your project:
mkdir -p .claude/workflows
curl -O --output-dir .claude/workflows \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/workflows/smoke.js \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/workflows/full-audit.js \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/workflows/safety-gate.js \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/workflows/bootstrap.js \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/workflows/multi-page.js \
  https://raw.githubusercontent.com/vitron-ai/alethia-mcp/main/examples/.claude/workflows/regression.js
```

## GitHub Actions

`github-actions.yml` is a drop-in CI workflow that runs your `.alethia` test files on every push and pull request. Save it as `.github/workflows/alethia.yml` and adjust the "Start your app" step to match your stack.

See the file header for full setup instructions.
