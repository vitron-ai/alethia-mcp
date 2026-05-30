export const meta = {
  name: 'alethia:smoke',
  description: 'Quick smoke test — navigate to a URL and assert the page loads',
  phases: [
    { title: 'Smoke' },
  ],
}

// Pass args: { url: "http://localhost:3000", checks: "assert the dashboard heading is visible" }
const a = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const url = a.url || 'http://localhost:3000'
const checks = a.checks || 'assert the page is visible'

log(`Smoke test → ${url}`)

phase('Smoke')
const result = await agent(
  `Call alethia_tell with the following instructions and return the step results:\nnavigate to ${url}\n${checks}`,
  { label: 'smoke', phase: 'Smoke' }
)

return { url, result }
