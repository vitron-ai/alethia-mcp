# Designing UIs for Agent-Driven Testing

> Other frameworks were built for humans writing selectors.
> Alethia was built for agents writing English.
> Your UI is no longer read by Playwright. It's read by an AI.

---

## The shift

Playwright, Cypress, and Selenium were designed for a human at a keyboard typing `page.getByRole('button', { name: 'Submit' })`. Every API in those frameworks — chained locators, retry helpers, `waitFor(...)` — optimizes for the ergonomics of a person writing tests.

Alethia inverts the default caller. The primary thing driving your UI is an **AI agent**, not a developer. The agent speaks English: *"click Submit", "verify the dashboard is visible", "type user@example.com into email"*. It does not know what a CSS selector is, and it should not need to.

That changes how you design UIs that will be driven by agents.

---

## You probably don't need to do anything

Alethia's NLP compiler turns *"click Submit"* into `CLICK :text(Submit)`. The resolver then searches the DOM for the tightest match — considering `textContent`, `aria-label`, `placeholder`, and `value` — and ranks interactive elements (buttons, links, inputs) above containers. Most well-built UIs work without any instrumentation at all.

If you already write semantic HTML with proper labels, buttons, and roles — you're done. Agents will drive your UI fine.

Read on if:

- You're designing a **new** surface you expect to be agent-driven.
- Your agent is having trouble hitting a specific element.
- You want deterministic, non-ambiguous selectors for critical actions.

---

## What the resolver sees (priority order)

When an NLP step resolves to a selector, Alethia's resolver picks in this order:

1. **`:focused`** — whatever has focus right now. Emitted when an NLP step implies "the active thing" (e.g. *press Enter*).
2. **`:text("needle")`** — Alethia's semantic selector. Checks `textContent`, `aria-label`, `placeholder`, and form `value` with tight-match ranking:
   - Interactive elements (`<a>`, `<button>`, `<input>`, `<label>`, `<select>`, `<textarea>`) beat containers.
   - Smaller own-text beats larger (`<h1>TaskFlow</h1>` beats the `<div>` wrapping the whole app).
   - Explicit semantics (`aria-label`, `placeholder`) beat incidental text containment.
3. **Plain CSS selectors** — `#id`, `.class`, `[data-attr="..."]`, etc. Works normally. This includes `[data-alethia="..."]`, `[data-testid="..."]`, and any custom hook your app already uses.

The NLP compiler almost always emits a `:text(...)` selector. Direct CSS selectors show up when the agent has been given a specific hook to target, or when the NLP script is written by a human.

---

## Making your UI deterministic for agents

If you want a control to be unambiguously addressable — especially in regulated, compliance-critical, or production-adjacent surfaces — add a stable hook attribute. Alethia respects any of these, in order of preference:

```
1. [data-alethia="..."]    ← preferred — signals agent-intent
2. [data-agent="..."]      ← generic convention for agent-driven UIs
3. [data-testid="..."]     ← existing test-infrastructure convention (works)
```

Use `data-alethia` when you want to signal *"this control is an agent-intent hook, not a QA test-id."* Use `data-testid` if your existing test infrastructure already has it wired up — no need to duplicate.

**Why `data-*`?** It's the only HTML-spec-compliant way to add custom attributes. Every modern framework (React, Vue, Svelte, Solid) passes `data-*` through without stripping it. DOM sanitizers allowlist `data-*` by default. HTML validators won't warn. Accessibility linters won't flag it. Your own compliance tooling works.

```html
<!-- Preferred: agent-intent hook -->
<button data-alethia="confirm-purchase" class="btn-primary">
  Confirm Purchase
</button>

<!-- Already have a test-id convention? That works too. -->
<button data-testid="confirm-purchase" class="btn-primary">
  Confirm Purchase
</button>
```

Then in NLP, the agent can still say *"click Confirm Purchase"* and Alethia will find it via `:text()`. The attribute is insurance for the cases where text is ambiguous.

---

## Anti-patterns that don't apply here

Habits from Playwright/Cypress/Selenium that **do not carry over**:

- **You don't need test IDs on every element.** If the resolver can find your button from its visible text and semantic role, adding a test ID is noise.
- **You don't need to restructure your DOM for selector chains.** The `:text()` ranker handles nested layouts.
- **You don't need to document selectors as part of your component API.** Agents don't read them. A human partner *reviewing your evidence pack* reads them if they show up — and by then the action already succeeded or was blocked.

---

## What trips the resolver up (and how to avoid it)

A short list of real patterns that make agent-driven testing painful:

- **Two controls with the same visible label.** *"Delete"* on every row of a table — the resolver picks one, but which one? Scope the label: *"Delete row 3"* in the NLP, or add `data-alethia="delete-row-3"` server-side.
- **Empty buttons with only an icon** — no text, no `aria-label`. The `:text()` path can't see it. Add an `aria-label` (this fixes accessibility too).
- **Text inside a parent that also contains other matching text.** The ranker handles most cases, but stacked `<div>`s with duplicate text inside interactive parents are ambiguous. Lean on semantic HTML (`<button>`, `<a>`).
- **Custom elements that throw on property access.** Rare, but the resolver tolerates per-element failures and skips them.
- **Shadow DOM with closed roots.** The resolver walks light DOM. If your critical controls live inside a closed shadow root, they're invisible. Reconsider whether the root needs to be closed.

None of these are Alethia-specific — every one of them is also an accessibility or maintainability problem. Designing a UI that an agent can reliably drive is, almost always, also designing a UI a screen reader can reliably read.

---

## Related

Sessions can be exported as signed records via the `alethia_export_session` tool. Compliance-minded teams run this at session end. This is independent of how your UI is hooked — it's a runtime feature.

See the [agent cookbook](./agent-cookbook.md) for paste-ready prompts that exercise the full tool surface, including the compliance-audit scenario.
