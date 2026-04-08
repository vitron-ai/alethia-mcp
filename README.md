# @vitronai/alethia

MCP bridge for [Alethia](https://github.com/vitron-ai/alethia) — the zero-IPC E2E testing framework built for AI agents.

Connect Claude, GPT, Cursor, or any MCP-compatible agent to Alethia with one config line.

## Requirements

1. **Alethia desktop app** running locally — [download the latest release](https://github.com/vitron-ai/alethia/releases)
2. Node.js 18+

## Install

```bash
npm install -g @vitronai/alethia
```

## Configure Claude Code

Add to your `claude_desktop_config.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "alethia-mcp"
    }
  }
}
```

## Configure Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "npx",
      "args": ["-y", "@vitronai/alethia"]
    }
  }
}
```

## Usage

Once configured, Claude can run E2E tests in plain English:

```
navigate to http://localhost:3000/login
type admin@example.com into the email field
type password123 into the password field
click Sign In
assert the dashboard heading is visible
```

## Tools

### `alethia_tell`
Execute natural language test instructions against the app under test.

### `alethia_compile`
Compile instructions to Action IR without executing — preview before you run.

## Privacy

Everything runs on your machine. No cloud. No telemetry. No data leaves your network.

## License

MIT — vitron-ai 2026
