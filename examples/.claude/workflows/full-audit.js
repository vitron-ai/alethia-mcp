export const meta = {
  name: 'alethia:full-audit',
  description: 'Navigate to a URL, run WCAG + NIST audits in parallel, export a signed evidence pack',
  phases: [
    { title: 'Navigate' },
    { title: 'Audit' },
    { title: 'Export' },
  ],
}

// Pass args: { url: "http://localhost:3000" } to target a specific origin.
const a = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const url = a.url || 'http://localhost:3000'

log(`Full compliance audit → ${url}`)

phase('Navigate')
await agent(
  `Call alethia_tell with the following instructions and return "ok" on success or the error on failure:\nnavigate to ${url}\nassert the page loaded successfully`,
  { label: 'navigate', phase: 'Navigate' }
)

phase('Audit')
const [wcag, nist] = await parallel([
  () => agent(
    'Call alethia_audit_wcag and return the full result as JSON, including pass/fail counts and any violations.',
    { label: 'wcag', phase: 'Audit' }
  ),
  () => agent(
    'Call alethia_audit_nist and return the full result as JSON, including pass/fail counts and any findings.',
    { label: 'nist', phase: 'Audit' }
  ),
])

phase('Export')
const pack = await agent(
  'Call alethia_export_session and return the SHA-256 integrity hash from the result.',
  { label: 'export', phase: 'Export' }
)

return { url, wcag, nist, evidenceHash: pack }
