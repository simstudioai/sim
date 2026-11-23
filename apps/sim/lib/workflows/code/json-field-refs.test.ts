/**
 * JSON code fields written as object literals, proved against the real executor: a workflow file
 * compiles to stored text, the stored workflow serializes as it would run, and the real
 * `VariableResolver` resolves the stored text with real block outputs. Every reference keeps its
 * value's type (a number stays a number, a list a list, a string a string), and a template is
 * text, which is the contract `json-fields.ts` stores the text for.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { createExecutorContext } from '@sim/testing/factories/executor-context.factory'
import { compileWorkflow, materialize } from '@sim/workflow-code'
import { goldenCatalog as catalog } from '@/lib/workflows/code/golden-cases.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { ExecutionState } from '@/executor/execution/state'
import { VariableResolver } from '@/executor/variables/resolver'
import { Serializer } from '@/serializer'

const SOURCE = `// @sim-sdk 1
import { response, t, table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Typed refs', {}, () => {
  const ticketIn = trigger.start('Ticket in', {
    inputFormat: { subject: 'string', score: 'number', tags: 'array', urgent: 'boolean' },
  })
  const logTicket = table.insertRow('Log ticket', {
    tableId: table('tickets'),
    data: {
      subject: ticketIn.subject,
      score: ticketIn.score,
      tags: ticketIn.tags,
      urgent: ticketIn.urgent,
      scoreText: t\`\${ticketIn.score}\`,
      note: t\`re: \${ticketIn.subject}\`,
    },
  })
  const reply = response('Reply', {
    body: { ok: true, subject: ticketIn.subject, score: ticketIn.score, tags: [ticketIn.tags] },
  })
  ticketIn.to(logTicket).to(reply)
})
`

const TICKET = { subject: 'Refund please', score: 3, tags: ['billing', 'vip'], urgent: true }

/** The stored workflow the source compiles to, serialized as the executor runs it. */
function compileAndSerialize() {
  const compiled = compileWorkflow({
    entry: { path: 'workflow.ts', text: SOURCE },
    files: new Map(),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
  expect(compiled.diagnostics).toEqual([])
  if (!compiled.workflow) throw new Error('compile failed')
  const { state } = materialize(compiled.workflow, null, {
    catalog,
    hooks: createMaterializeHooks(),
    lockFreshness: 'none',
  })
  const serialized = new Serializer().serializeWorkflow(
    state.blocks,
    state.edges,
    state.loops,
    state.parallels
  )
  const byName = (name: string) => {
    const block = serialized.blocks.find((candidate) => candidate.metadata?.name === name)
    if (!block) throw new Error(`no block ${name}`)
    return block
  }
  return { serialized, byName }
}

async function resolvedParams(blockName: string) {
  const { serialized, byName } = compileAndSerialize()
  const executionState = new ExecutionState()
  executionState.setBlockOutput(byName('Ticket in').id, TICKET)
  const ctx = createExecutorContext({ blockStates: new Map(executionState.getBlockStates()) })
  const block = byName(blockName)
  const resolver = new VariableResolver(serialized, {}, executionState)
  return resolver.resolveInputs(ctx, block.id, block.config.params, block)
}

describe('JSON field literals against the real resolver', () => {
  it('resolve every bare reference with its type and every template as text', async () => {
    const params = await resolvedParams('Log ticket')
    expect(JSON.parse(params.data)).toStrictEqual({
      subject: 'Refund please',
      score: 3,
      tags: ['billing', 'vip'],
      urgent: true,
      scoreText: '3',
      note: 're: Refund please',
    })
  })

  it('resolve a response body the same way', async () => {
    const params = await resolvedParams('Reply')
    expect(params.dataMode).toBe('json')
    expect(JSON.parse(params.data)).toStrictEqual({
      ok: true,
      subject: 'Refund please',
      score: 3,
      tags: [['billing', 'vip']],
    })
  })
})
