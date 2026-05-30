export const meta = {
  name: 'alethia:safety-gate',
  description: 'Prove the VITRON-EA1 gate blocks every destructive action on a page',
  phases: [
    { title: 'Safety Check' },
  ],
}

// Pass args: { url: "http://localhost:3000/admin" }
const a = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const url = a.url || 'http://localhost:3000'

log(`EA1 safety gate audit → ${url}`)

phase('Safety Check')
const result = await agent(
  `Call alethia_assert_safety with url: "${url}". Return the full per-action block/allow report. Highlight any row where blocked is false — those are safety regressions.`,
  { label: 'assert-safety', phase: 'Safety Check' }
)

return { url, result }
