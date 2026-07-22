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
    canonicalModes: null,
    toolInputValues: null,
  }
}

describe('resolveWorkflowReferences', () => {
  it('resolves direct callers and callees', () => {
    const blocks = [workflowBlock('a', 'b'), workflowBlock('a', 'c')]
    const { callers, callees } = resolveWorkflowReferences('a', workflows, blocks, [])

    expect(callers).toEqual([])
    expect(callees.map((n) => n.id)).toEqual(['b', 'c'])

    const bResult = resolveWorkflowReferences('b', workflows, blocks, [])
    expect(bResult.callers.map((n) => n.id)).toEqual(['a'])
    expect(bResult.callees).toEqual([])
  })

  it('resolves references made through workflow_input blocks', () => {
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

  it('uses the active mode, not a retained inactive value', () => {
    // Advanced mode active (canonicalModes override), but a stale basic value
    // (`b`) lingers. Must resolve to the advanced value (`c`), not the stale basic.
    const blocks: ReferenceBlockRow[] = [
      {
        parentId: 'a',
        type: 'workflow',
        childFromSelector: 'b',
        childFromManual: 'c',
        canonicalModes: { workflowId: 'advanced' },
        toolInputValues: null,
      },
    ]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees.map((n) => n.id)).toEqual(['c'])
  })

  it('marks cycles as leaves and stops recursing', () => {
    const blocks = [workflowBlock('a', 'b'), workflowBlock('b', 'a')]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])

    expect(callees).toHaveLength(1)
    expect(callees[0]).toMatchObject({ id: 'b', cycle: false })
    expect(callees[0].children).toHaveLength(1)
    expect(callees[0].children[0]).toMatchObject({ id: 'a', cycle: true, children: [] })
  })

  it('shows a self-reference as a cycle leaf', () => {
    // A → A: the reference is real and belongs in the cycle-safe viewer.
    const blocks = [workflowBlock('a', 'a')]
    const { callers, callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees).toEqual([{ id: 'a', name: 'A', cycle: true, children: [] }])
    expect(callers).toEqual([{ id: 'a', name: 'A', cycle: true, children: [] }])
  })

  it('bounds converging paths (diamond) instead of re-expanding', () => {
    // A → B, A → C, B → D, C → D. D reconverges; it must appear under both B and C
    // but only expand once (here D is a leaf anyway; the guard prevents blow-up).
    const blocks = [
      workflowBlock('a', 'b'),
      workflowBlock('a', 'c'),
      workflowBlock('b', 'd'),
      workflowBlock('c', 'd'),
    ]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    const b = callees.find((n) => n.id === 'b')
    const c = callees.find((n) => n.id === 'c')
    // D expands under the first-visited branch (B) and is a plain leaf under C.
    expect(b?.children.map((n) => n.id)).toEqual(['d'])
    expect(c?.children.map((n) => n.id)).toEqual(['d'])
    expect(c?.children[0]).toMatchObject({ id: 'd', cycle: false, children: [] })
  })

  it('drops dangling / out-of-workspace child ids', () => {
    const blocks = [workflowBlock('a', 'missing')]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees).toEqual([])
  })

  it('resolves references made through custom blocks', () => {
    // D places custom_block_x, which is bound to source workflow C.
    const blocks: ReferenceBlockRow[] = [
      {
        parentId: 'd',
        type: 'custom_block_x',
        childFromSelector: null,
        childFromManual: null,
        canonicalModes: null,
        toolInputValues: null,
      },
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
        canonicalModes: null,
        toolInputValues: null,
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

  it('resolves workflow tools inside tool-input sub-blocks', () => {
    // Agent block on A carrying a workflow_input tool that calls B; a non-workflow
    // tool and a malformed entry must be ignored.
    const blocks: ReferenceBlockRow[] = [
      {
        parentId: 'a',
        type: 'agent',
        childFromSelector: null,
        childFromManual: null,
        canonicalModes: null,
        toolInputValues: [
          [
            { type: 'workflow_input', params: { workflowId: 'b' } },
            { type: 'function', params: {} },
            { type: 'workflow_input' },
          ],
        ],
      },
    ]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees.map((n) => n.id)).toEqual(['b'])

    const bResult = resolveWorkflowReferences('b', workflows, blocks, [])
    expect(bResult.callers.map((n) => n.id)).toEqual(['a'])
  })

  it('resolves workflow tools from a JSON-stringified tool-input value', () => {
    const blocks: ReferenceBlockRow[] = [
      {
        parentId: 'a',
        type: 'agent',
        childFromSelector: null,
        childFromManual: null,
        canonicalModes: null,
        toolInputValues: [
          JSON.stringify([{ type: 'workflow_input', params: { workflowId: 'c' } }]),
        ],
      },
    ]
    const { callees } = resolveWorkflowReferences('a', workflows, blocks, [])
    expect(callees.map((n) => n.id)).toEqual(['c'])
  })
})
