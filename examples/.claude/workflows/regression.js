export const meta = {
  name: 'alethia:regression',
  description: 'Run a fixed assertion suite against a URL and fail on any regression',
  phases: [
    { title: 'Run' },
    { title: 'Export' },
  ],
}

// Pass args: { url: "http://localhost:3000", checks: ["assert Login is visible", "assert the form submits"] }
// checks: array of NLP assertion strings. Run on every CI push to catch regressions.
const a = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const url = a.url || 'http://localhost:3000'
const checks = Array.isArray(a.checks) ? a.checks : []

if (checks.length === 0) {
  log('No checks provided — pass checks: ["assert X is visible", ...] to define your suite')
  return { url, passed: false, error: 'no checks provided' }
}

const instructions = [`navigate to ${url}`, ...checks].join('\n')
log(`Regression: ${checks.length} check(s) against ${url}`)

phase('Run')
const run = await agent(
  `Call alethia_tell with the following instructions and return step-by-step pass/fail results:\n${instructions}`,
  { label: 'run', phase: 'Run' }
)

phase('Export')
const pack = await agent(
  'Call alethia_export_session and return the SHA-256 integrity hash from the result.',
  { label: 'export', phase: 'Export' }
)

return { url, checksRun: checks.length, result: run, evidenceHash: pack }
