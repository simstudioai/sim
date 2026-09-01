/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { emptyRunFromBlockSnapshot, overlayVariableInputs } from '@/executor/utils/run-from-block'
import type { SerializedWorkflow } from '@/serializer/types'

const workflow = {
  version: '1',
  blocks: [
    { id: 'b-start', metadata: { id: 'starter', name: 'Start' } },
    { id: 'b-fetch', metadata: { id: 'api', name: 'Fetch Orders' } },
    { id: 'b-fn', metadata: { id: 'function', name: 'Transform' } },
  ],
  connections: [],
  loops: {},
} as unknown as SerializedWorkflow

describe('overlayVariableInputs', () => {
  it('resolves block names with executor normalization and marks mocks executed', () => {
    const out = overlayVariableInputs(workflow, emptyRunFromBlockSnapshot(), {
      'fetch orders': { content: 'rows' },
    })
    expect(out.blockStates['b-fetch']).toEqual({
      output: { content: 'rows' },
      executed: true,
      executionTime: 0,
    })
    expect(out.executedBlocks).toContain('b-fetch')
  })

  it('accepts raw block ids and overrides existing snapshot state', () => {
    const snapshot = emptyRunFromBlockSnapshot()
    snapshot.blockStates['b-fetch'] = {
      output: { content: 'stale' },
      executed: true,
      executionTime: 5,
    }
    snapshot.executedBlocks.push('b-fetch')
    const out = overlayVariableInputs(workflow, snapshot, { 'b-fetch': { content: 'fresh' } })
    expect(out.blockStates['b-fetch'].output).toEqual({ content: 'fresh' })
    expect(out.executedBlocks.filter((id) => id === 'b-fetch')).toHaveLength(1)
  })

  it('fails fast on unknown block names, listing what exists', () => {
    expect(() =>
      overlayVariableInputs(workflow, emptyRunFromBlockSnapshot(), { nope: { a: 1 } })
    ).toThrow(/no block named "nope".*Fetch Orders/s)
  })

  it('rejects non-object mocks with an actionable message', () => {
    expect(() =>
      overlayVariableInputs(workflow, emptyRunFromBlockSnapshot(), { Transform: 'scalar' })
    ).toThrow(/must be an object/)
  })

  it('does not mutate the input snapshot', () => {
    const snapshot = emptyRunFromBlockSnapshot()
    overlayVariableInputs(workflow, snapshot, { Transform: { ok: true } })
    expect(snapshot.blockStates).toEqual({})
    expect(snapshot.executedBlocks).toEqual([])
  })
})
