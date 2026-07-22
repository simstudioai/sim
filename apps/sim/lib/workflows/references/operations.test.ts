/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type CustomBlockLink,
  type ReferenceBlockRow,
  resolveWorkflowReferences,
  type WorkflowNode,
} from '@/lib/workflows/references/operations'

const workflows: WorkflowNode[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' },
]

function workflowBlock(
  parentId: string,
  childId: string,
  mode: 'basic' | 'manual' = 'basic',
  type: 'workflow' | 'workflow_input' = 'workflow'
): ReferenceBlockRow {
  return {
    parentId,
    type,
    childFromSelector: mode === 'basic' ? childId : null,
    childFromManual: mode === 'manual' ? childId : null,
  }
}

describe('resolveWorkflowReferences', () => {
  it('resolves direct callers and callees', () => {
    // A → B, A → C
    const blocks = [workflowBlock('a', 'b'), workflowBlock('a', 'c')]
    const { callers, callees } = resolveWorkflowReferences('a', workflows, blocks, [])

    expect(callers).toEqual([])
    expect(callees.map((n) => n.id)).toEqual(['b', 'c'])

    const bResult = resolveWorkflowReferences('b', workflows, blocks, [])
    expect(bResult.callers.map((n) => n.id)).toEqual(['a'])
    expect(bResult.callees).toEqual([])
  })

  it('resolves references made through workflow_input blocks', () => {
    // A → B → C, all via the workflow_input block type.
    const blocks = [
      workflowBlock('a', 'b', 'basic', 'workflow_input'),
      workflowBlock('b', 'c', 'basic', 'workflow_input'),
    ]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees.map((n) => n.id)).toEqual(['b'])
    expect(callees[0].children.map((n) => n.id)).toEqual(['c'])

    const cResult = resolveWorkflowReferences('c', workflows, blocks, [])
    expect(cResult.callers.map((n) => n.id)).toEqual(['b'])
    expect(cResult.callers[0].children.map((n) => n.id)).toEqual(['a'])
  })

  it('resolves the advanced-mode manualWorkflowId value', () => {
    const blocks = [workflowBlock('a', 'b', 'manual')]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees.map((n) => n.id)).toEqual(['b'])
  })

  it('marks cycles as leaves and stops recursing', () => {
    // A → B → A
    const blocks = [workflowBlock('a', 'b'), workflowBlock('b', 'a')]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])

    expect(callees).toHaveLength(1)
    expect(callees[0]).toMatchObject({ id: 'b', cycle: false })
    expect(callees[0].children).toHaveLength(1)
    expect(callees[0].children[0]).toMatchObject({ id: 'a', cycle: true, children: [] })
  })

  it('drops self-references', () => {
    const blocks = [workflowBlock('a', 'a')]
    const { callers, callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callers).toEqual([])
    expect(callees).toEqual([])
  })

  it('drops dangling / out-of-workspace child ids', () => {
    const blocks = [workflowBlock('a', 'missing')]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees).toEqual([])
  })

  it('resolves references made through custom blocks', () => {
    // D places custom_block_x, which is bound to source workflow C.
    const blocks: ReferenceBlockRow[] = [
      { parentId: 'd', type: 'custom_block_x', childFromSelector: null, childFromManual: null },
    ]
    const customBlocks: CustomBlockLink[] = [{ type: 'custom_block_x', workflowId: 'c' }]

    const cResult = resolveWorkflowReferences('c', workflows, blocks, customBlocks)
    expect(cResult.callers.map((n) => n.id)).toEqual(['d'])

    const dResult = resolveWorkflowReferences('d', workflows, blocks, customBlocks)
    expect(dResult.callees.map((n) => n.id)).toEqual(['c'])
  })

  it('ignores custom blocks with no bound source in scope', () => {
    const blocks: ReferenceBlockRow[] = [
      {
        parentId: 'd',
        type: 'custom_block_unknown',
        childFromSelector: null,
        childFromManual: null,
      },
    ]
    const { callees } = resolveWorkflowReferences('d', workflows, blocks, [])
    expect(callees).toEqual([])
  })

  it('returns empty trees when the workflow is not a workspace node', () => {
    const blocks = [workflowBlock('a', 'b')]
    const result = resolveWorkflowReferences('unknown', workflows, blocks, [])
    expect(result).toEqual({ callers: [], callees: [] })
  })

  it('sorts children by name', () => {
    // Names: B, C — insert in reverse to prove sorting.
    const blocks = [workflowBlock('a', 'c'), workflowBlock('a', 'b')]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees.map((n) => n.name)).toEqual(['B', 'C'])
  })
})
