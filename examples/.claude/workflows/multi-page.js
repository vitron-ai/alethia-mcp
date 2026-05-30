export const meta = {
  name: 'alethia:multi-page',
  description: 'Smoke test multiple pages in parallel using alethia_tell_parallel',
  phases: [
    { title: 'Parallel Smoke' },
  ],
}

// Pass args: { pages: [{ url, checks, name }, ...] }
// Example: { pages: [{ url: "http://localhost:3000", checks: "assert the dashboard is visible", name: "home" }] }
const a = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const pages = a.pages || [{ url: 'http://localhost:3000', checks: 'assert the page is visible' }]

log(`Running parallel smoke across ${pages.length} page(s)`)

phase('Parallel Smoke')

const specs = pages.map(p => ({
  url: p.url,
  instructions: p.checks ? `navigate to ${p.url}\n${p.checks}` : `navigate to ${p.url}`,
  name: p.name || p.url,
}))

const result = await agent(
  `Call alethia_tell_parallel with this specs array and return all results per page:\n${JSON.stringify(specs, null, 2)}`,
  { label: 'parallel-smoke', phase: 'Parallel Smoke' }
)

return { pagesRun: pages.length, result }
