export const meta = {
  name: 'alethia:bootstrap',
  description: 'Scan a page with propose_tests then run each named block sequentially',
  phases: [
    { title: 'Propose' },
    { title: 'Run' },
  ],
}

// Pass args: { url: "http://localhost:3000" }
const a = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const url = a.url || 'http://localhost:3000'

log(`Bootstrapping test suite for ${url}`)

phase('Propose')

const BLOCKS_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          instructions: { type: 'string' },
        },
        required: ['name', 'instructions'],
      },
    },
  },
  required: ['blocks'],
}

const proposed = await agent(
  `Call alethia_propose_tests with url: "${url}". Return the result as structured data: an array of blocks, each with a "name" (the block title) and "instructions" (the exact NLP text for that block, newline-separated).`,
  { label: 'propose', phase: 'Propose', schema: BLOCKS_SCHEMA }
)

if (!proposed || !proposed.blocks || proposed.blocks.length === 0) {
  log('No blocks returned — is the app running at that URL?')
  return { url, blocksRun: 0, results: [] }
}

log(`${proposed.blocks.length} blocks proposed — running sequentially`)

phase('Run')

const results = []
for (const block of proposed.blocks) {
  const result = await agent(
    `Call alethia_tell with the following instructions and return the step results:\n${block.instructions}`,
    { label: block.name, phase: 'Run' }
  )
  results.push({ name: block.name, result })
}

return { url, blocksRun: proposed.blocks.length, results }
