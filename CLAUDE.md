# alethia-mcp

MCP bridge connecting AI agents (Claude Code, Cursor, Cline, etc.) to the Alethia E2E test runtime.

## Build

```bash
npm run build        # tsc → dist/index.js
npm run dev          # tsc --watch
```

Entry point: [src/index.ts](src/index.ts) → compiled to `dist/index.js`.

## Test

```bash
npm test
```

Runs `bridge-tests/*.test.mjs` via `@vitronai/themis`. Tests cover bridge smoke, self-update, CLI flags, runtime version resolution, and symlink spawning. Config in [themis.config.json](themis.config.json).

## Run the bridge locally

```bash
node dist/index.js
```

Starts the MCP stdio server. The Alethia runtime auto-downloads on first tool call (~100 MB, Ed25519-verified from GitHub Releases). Needs a built `dist/` first.

## Demo pages

```bash
# Option 1 — use the MCP tool from Claude Code:
alethia_serve_demo()

# Option 2 — serve manually:
npx serve demo/
```

Each `demo/*.alethia` file is the NLP test script for its paired `*.html` page. Run them with `alethia_tell` to see the runtime in action.

## Skill

The Claude Code skill lives at [skills/alethia/SKILL.md](skills/alethia/SKILL.md). It auto-installs to `~/.claude/skills/alethia/SKILL.md` on bridge startup and auto-refreshes when the bundled copy is newer.

## Key paths

| Path | Purpose |
|------|---------|
| `src/index.ts` | Bridge entrypoint — MCP server, tool handlers, runtime installer |
| `bridge-tests/` | Unit/integration tests (themis) |
| `demo/` | Demo HTML pages + paired `.alethia` NLP scripts |
| `skills/alethia/SKILL.md` | Bundled Claude Code skill |
| `examples/` | Copy-paste integration examples for downstream projects |
| `dist/` | Compiled output — do not edit directly |
