# E2E CI Pipeline — Spec

**Status:** proposed
**Date:** 2026-04-28
**Goal:** Run `alethia run` against our own demo suite in GitHub Actions so the
public CI badge proves the runtime + bridge + NLP compiler all work end-to-end
together, not just in isolation.

## Why this matters

We just shipped `alethia run` (bridge v0.8.5) as the CI on-ramp. We've told
users *"this is how you run Alethia in your pipeline"* but our *own* pipelines
(`alethia-mcp/bridge-tests.yml`, `alethia-core/quality-gates.yml`) only run unit
+ validation tests. Neither actually drives the runtime through `alethia run`.

That's a credibility gap. The fix is small: one workflow that does what users
will do.

Three concrete payoffs:

1. **Catches integration bugs** unit tests miss: packaging regressions, runtime
   spawn / bridge / NLP-compiler drift, signed-binary fetch breakage, port
   collisions, stale cache fallback.
2. **Public showcase.** A passing badge that says *"Alethia passes its own E2E
   suite via `alethia run`"* is a sharper sales line than any benchmark number.
3. **Living example.** `examples/github-actions.yml` we ship to users is then
   exactly what we use ourselves — no template-vs-real-world drift.

## Scope (v1 — minimum viable end-to-end run)

One workflow, one demo. Prove the end-to-end path before expanding to the full
demo matrix.

**File:** `alethia-mcp/.github/workflows/e2e.yml`

**Job shape:**

1. Checkout
2. Setup Node 20
3. `npm ci` + `npm run build` (use the *current PR's* bridge code, not the
   published one — catches regressions before they ship to npm)
4. Restore cache for `~/.alethia/runtime/` keyed on the runtime version we're
   targeting (avoids the ~100 MB download per run on cache hit)
5. Start a static HTTP server on the `demo/` directory (Python `http.server`
   or `npx serve` — keep dependency-free)
6. Run `node dist/index.js run demo/claude-code-app.alethia` against it
7. On failure: surface the per-step diagnostics to the GHA log via
   `::group::` collapsibles

**Why this demo first:** `claude-code-app.alethia` is the showcase demo
referenced in the bridge README; it covers navigate, type, click, assert
visible, and assertion-on-text-after-mutation. Hits every common verb without
exercising the more delicate ones (EA1 block-paths, accessibility audits).

**Pinned runtime version:** the workflow pins
`ALETHIA_RUNTIME_VERSION=0.7.1` so cache keys are stable and tests are
reproducible. When we cut a new runtime, we bump this in one place.

**Time budget:** ~90s on cache hit, ~3min on cache miss (runtime download).
Anything over 5min is a red flag — investigate before merging.

## Out of scope (v1)

- **All 12 demos as a matrix.** Save for v2 once v1 is stable. One demo proves
  the path; full matrix is multiplier on cost.
- **Cypress-style retry / video capture.** GHA logs + `--json` output are
  enough for now.
- **Cross-platform (Windows, macOS).** The bridge already runs the Windows
  smoke test in `bridge-tests.yml`; the runtime test on linux-x64 is the
  90% case.
- **Live npm-published bridge testing.** v1 tests the *current PR's* bridge
  source. Optional v2 job: install the published bridge alongside, run the
  same test. Belt-and-suspenders against packaging drift.

## What we're explicitly NOT doing

- **Mirroring the Jest/Vitest `__tests__/` convention.** `.alethia` files live
  wherever the user wants them — no enforced directory. The bridge doesn't
  need a discovery mechanism, just a path.
- **A test-runner abstraction layer.** `alethia run <path>` is the runner.
  Loops are bash. No new mental model.
- **Configuration files** (`alethia.config.ts`, etc). One env var
  (`ALETHIA_RUNTIME_VERSION`) + flags is the surface.

## README update (alongside this workflow)

Update the "Running in CI" section to:

1. **Use the `name <label>` first-line directive** in the example so cockpit
   history reads cleanly when the same NLP runs locally.
2. **Use realistic paths** like `tests/e2e/login.alethia` — not enforced
   conventions. Whatever directory makes sense in the user's repo.
3. Reference our own E2E workflow as a real-world example link.

## Cost / shape

- ~half a day to write + iterate. Most of the time is the cache key dance
  and verifying the runtime download on cache miss completes within budget.
- Files touched: 1 new workflow, README update, possibly tweak the existing
  `claude-code-app.alethia` if any verbs in it depend on a host that the
  static server doesn't provide.

## Open questions

1. **Where does the demo HTTP server run from?** The `demo/` dir is in the
   bridge repo so checkout + `npx serve demo` is the simplest path. Verify
   that the demo's NLP file references match the static server's URL shape
   (port 8765 in the existing `.alethia` files — adjust workflow to match).
2. **Do we want a separate `e2e.yml` workflow or fold into `bridge-tests`?**
   Separate keeps the matrix clean (Node 20 + 22 unit-tests stay fast) and
   lets the E2E job run only on linux-x64 without slowing the matrix.
   Recommend separate file.
3. **Should runtime download happen in CI or pre-bake into a base image?**
   Cache-keyed download is simpler today; base-image is a v2 optimization
   if download becomes the bottleneck.

## Triggers to expand to v2

- v1 stable for 2+ weeks with no flakes
- A demo gets added or changed and we want CI to catch its regression
- A partner asks for cross-platform CI proof
