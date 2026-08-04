# Installing Alethia for Cline

This file is for AI agents (like Cline) installing this MCP server on a user's behalf. Follow these steps exactly — the runtime auto-install step behaves differently from a typical `npm install` and has caught agents off guard before.

## 1. Install the bridge

```bash
npm install -g @vitronai/alethia
```

## 2. Add the MCP server config

Find Cline's MCP settings file (usually `cline_mcp_settings.json` in the extension's settings directory) and merge this entry into the `mcpServers` object:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "alethia-mcp"
    }
  }
}
```

Restart Cline (or reload the MCP servers) after saving.

## 3. Expect a slow first tool call — this is normal, not a failure

The bridge auto-downloads a separate, Ed25519-signed runtime binary (~100 MB) the first time any Alethia tool is called — not during `npm install`. On a cold cache, that first call can take **20-30+ seconds** (download, signature verification, extraction) before it returns a result. If a tool call appears to hang immediately after install, **wait** rather than retrying or reporting failure — retrying does not skip the download, it just restarts the same wait.

Look for these lines on stderr during this window (normal, expected):
```
[alethia] Runtime not found. Auto-installing v0.8.0...
[alethia] Verifying Ed25519 signature...
[alethia] SHA-256 verified.
[alethia] Extracting runtime...
[alethia] Spawning runtime (visible)...
```

Subsequent calls are fast (~13ms/step) once the runtime is installed and running.

## 4. Headless / remote / container environments

By default, Alethia opens a visible "cockpit" window showing the browser it's driving live. If you're installing this in a remote dev container, SSH session, WSL without a display, or any environment without a GUI, set this environment variable in the MCP config **before** the first tool call:

```json
{
  "mcpServers": {
    "alethia": {
      "command": "alethia-mcp",
      "env": {
        "ALETHIA_HEADLESS": "1"
      }
    }
  }
}
```

CI environments are auto-detected and hidden by default; interactive remote/headless sessions are not always auto-detected, so set this explicitly if there's no display available.

## 5. Verify it worked

Call the `alethia_status` tool. A successful install returns JSON like:

```json
{
  "ok": true,
  "version": "0.8.0",
  "defaultPolicyProfile": "controlled-web",
  "killSwitch": { "active": false }
}
```

If this returns cleanly, the install is complete and every other tool (`alethia_tell`, `alethia_audit_wcag`, etc.) is ready to use.
