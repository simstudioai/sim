/**
 * The mistakes a cold agent made writing workflow source (the blind DX trial), compiled against
 * the REAL block catalog: each one gets exactly the finding that names its fix, and nothing that
 * sends the author after a problem the source does not have.
 */
import { type CompileResult, compileWorkflow } from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'

/** The trial's clean probe: agent → API → table insert → Slack, which compiles with no finding. */
const BASE = `// @sim-sdk 1
import { agent, api, credential, env, js, condition, slack, t, table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Mistake', { description: 'Mistake probe.' }, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string', question: 'string' } })
  const ask = agent('Ask', {
    model: 'claude-sonnet-4-6',
    apiKey: env.ANTHROPIC_API_KEY,
    messages: [{ role: 'user', content: start.question }],
    temperature: 0.3,
  })
  const call = api('Call', { url: 'https://example.com/hook', method: 'POST', body: { text: t\`\${ask.content}\` } })
  const save = table.insertRow('Save', {
    tableId: table('contacts'),
    data: { email: start.email, status: 'pending' },
  })
  const notify = slack.sendMessage('Notify', {
    credential: credential('ops-slack'),
    destinationType: 'channel',
    channel: 'ops',
    text: t\`Answer: \${ask.content}\`,
  })
  start.to(ask)
  ask.to(call)
  call.to(save)
  save.to(notify)
})
`

/** The base probe with one edit, failing loudly when the edit no longer applies. */
function probe(find: string, replace: string): string {
  if (!BASE.includes(find)) throw new Error(`the base probe has no ${find}`)
  return BASE.replace(find, replace)
}

function compile(text: string): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
}

/** Errors and warnings as `CODE line: message`, the lines an author reads. */
function findings(result: CompileResult): string[] {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity !== 'info')
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.span.line}: ${diagnostic.message}`)
}

function only(result: CompileResult, code: string) {
  const matching = result.diagnostics.filter((diagnostic) => diagnostic.code === code)
  expect(matching).toHaveLength(1)
  return matching[0]
}

describe('mistakes from the blind DX trial, against the real catalog', () => {
  it('compiles the base probe with no finding', () => {
    expect(findings(compile(BASE))).toEqual([])
  })

  it('reports a misspelled bare builder once, with a did-you-mean and no cascade', () => {
    const result = compile(probe("api('Call'", "apii('Call'"))
    expect(findings(result)).toEqual(['E_UNKNOWN_BUILDER 12: apii is not a block builder.'])
    expect(only(result, 'E_UNKNOWN_BUILDER')?.hint).toBe('Did you mean api?')
  })

  it('names the missing import for a bare builder the file did not import', () => {
    const result = compile(probe('import { agent, api,', 'import { agent,'))
    expect(findings(result)).toEqual([
      "E_UNKNOWN_BUILDER 12: api is not imported from '@sim/workflow-sdk'.",
    ])
    expect(only(result, 'E_UNKNOWN_BUILDER')?.hint).toBe(
      "Add api to the import from '@sim/workflow-sdk'."
    )
  })

  it('reports a duplicate block name alone, without a phantom cycle through the first block', () => {
    const result = compile(probe("slack.sendMessage('Notify'", "slack.sendMessage('Ask'"))
    expect(findings(result)).toEqual([
      'E_DUPLICATE_NAME 17: Ask normalizes to ask, which Ask already uses.',
    ])
  })

  it('frames a cycle at the edge that closes it, naming that edge in the hint', () => {
    const result = compile(probe('save.to(notify)\n', 'save.to(notify)\n  notify.to(ask)\n'))
    const cycle = only(result, 'E_EDGE_CYCLE')
    expect(cycle?.span.line).toBe(27)
    expect(cycle?.hint).toBe(
      'Remove this edge from Notify back to Ask, and repeat work with loop() or parallel() around the blocks instead.'
    )
  })

  it('asks for a timezone only on a schedule type that uses one', () => {
    const schedule = (params: string) =>
      compile(`// @sim-sdk 1
import { api, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Sync', {}, () => {
  const tick = trigger.schedule('Tick', { ${params} })
  const call = api('Call', { url: 'https://example.com/hook' })
  tick.to(call)
})
`)
        .diagnostics.map((diagnostic) => diagnostic.code)
        .filter((code) => code === 'I_SCHEDULE_UTC' || code === 'W_FIELD_NOT_APPLICABLE')
    expect(schedule("scheduleType: 'hourly', hourlyMinute: 5")).toEqual([])
    expect(schedule("scheduleType: 'hourly', hourlyMinute: 5, timezone: 'UTC'")).toEqual([
      'W_FIELD_NOT_APPLICABLE',
    ])
    expect(schedule("scheduleType: 'minutes', minutesInterval: 15")).toEqual([])
    expect(schedule("scheduleType: 'daily', dailyTime: '09:00'")).toEqual(['I_SCHEDULE_UTC'])
  })

  it('warns on a slider value outside the range the catalog gives it', () => {
    const result = compile(probe('temperature: 0.3', 'temperature: 7'))
    expect(findings(result)).toEqual([
      'W_OUT_OF_RANGE 10: temperature is 7, outside its range; it is kept as written.',
    ])
    expect(only(result, 'W_OUT_OF_RANGE')?.hint).toBe('Write a value from 0 to 1.')
  })

  it("tells a literal token in a credential field to use credential('<key>')", () => {
    const result = compile(
      probe(
        "credential: credential('ops-slack')",
        `credential: 'xoxb-${'1234567890'}-abcdefghijklmnop'`
      )
    )
    expect(only(result, 'W_LITERAL_SECRET')?.hint).toBe(
      "Save the token as a workspace credential and write credential: credential('<key>'), so the token never sits in the workflow."
    )
  })
})
