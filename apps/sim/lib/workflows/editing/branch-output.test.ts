/** @vitest-environment node */
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { collectBranchDependentBlockOutputReferences } from '@/lib/workflows/editing/lint'

function block(id: string, type: string, value = ''): BlockState {
  return {
    id,
    type,
    name: id,
    enabled: true,
    position: { x: 0, y: 0 },
    outputs: {},
    subBlocks: { input: { id: 'input', type: 'short-input', value } },
  }
}
function edge(
  source: string,
  target: string,
  sourceHandle = 'source'
): WorkflowState['edges'][number] {
  return { id: `${source}-${target}`, source, target, sourceHandle }
}
function graph() {
  return {
    blocks: {
      start: block('start', 'starter'),
      branch: block('branch', 'condition'),
      file: block('file', 'function'),
      clarify: block('clarify', 'agent'),
      send: block('send', 'slack', '<file.files[0].path>'),
    },
    edges: [
      edge('start', 'branch'),
      edge('branch', 'file', 'condition-a'),
      edge('branch', 'clarify', 'condition-b'),
      edge('file', 'send'),
      edge('clarify', 'send'),
    ],
  }
}

describe('conditional output availability', () => {
  it('flags attachments produced only on the delivery branch at a shared send block', () => {
    const result = collectBranchDependentBlockOutputReferences(graph())
    expect(result.issues).toEqual([
      expect.objectContaining({
        blockId: 'send',
        field: 'input',
        value: '<file.files[0].path>',
        kind: 'block-output',
        reason: expect.stringContaining('condition-b'),
      }),
    ])
    expect(result.check.detail).toContain('Guards inside expressions')
  })

  it('accepts a consumer placed only on the producing branch', () => {
    const state = graph()
    state.edges = state.edges.filter(
      (edge) => !(edge.source === 'clarify' && edge.target === 'send')
    )
    expect(collectBranchDependentBlockOutputReferences(state).issues).toEqual([])
  })

  it('does not apply branch warnings to ordinary parallel outgoing edges', () => {
    const state = graph()
    state.blocks.branch.type = 'function'
    expect(collectBranchDependentBlockOutputReferences(state).issues).toEqual([])
  })

  it('accepts a value produced before the branch and shared dynamic references', () => {
    const state = graph()
    state.blocks.send.subBlocks.input.value =
      '<start.input> <variable.attachment> <environment.SECRET>'
    expect(collectBranchDependentBlockOutputReferences(state).issues).toEqual([])
  })

  it('uses normalized block names and groups repeated references', () => {
    const state = graph()
    state.blocks.file.name = 'Make File'
    state.blocks.send.subBlocks.input.value = '<makefile.files> <makefile.files>'
    expect(collectBranchDependentBlockOutputReferences(state).issues).toHaveLength(1)
  })

  it('reports skipped analysis for subflows without pretending they are safe', () => {
    const state = graph()
    state.blocks.file.type = 'loop'
    expect(collectBranchDependentBlockOutputReferences(state)).toMatchObject({
      issues: [],
      check: { status: 'skipped' },
    })
  })
})
