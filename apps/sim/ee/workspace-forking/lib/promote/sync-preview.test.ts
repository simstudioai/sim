/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  projectSyncSource,
  syncChangesWorkflow,
} from '@/ee/workspace-forking/lib/promote/sync-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

function state(code: string, blockId = 'b1', extra: Record<string, unknown> = {}): WorkflowState {
  return {
    blocks: {
      [blockId]: {
        id: blockId,
        type: 'function',
        name: 'Run',
        position: { x: 0, y: 0 },
        subBlocks: { code: { id: 'code', type: 'code', value: code } },
        outputs: {},
        enabled: true,
        ...extra,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as unknown as WorkflowState
}

/** Every source block pairs with the target block named `t-<id>`, as a recorded block map would. */
const resolve = (_targetWorkflowId: string, sourceBlockId: string) => `t-${sourceBlockId}`

describe('syncChangesWorkflow', () => {
  it('reports no change when the target draft already matches the projected source', () => {
    const before = state('return 1', 't-b1')
    const after = projectSyncSource(state('return 1'), before, 'wf-t', resolve)

    expect(syncChangesWorkflow(before, after)).toBe(false)
  })

  it('reports a change when a field differs', () => {
    const before = state('return 1', 't-b1')
    const after = projectSyncSource(state('return 2'), before, 'wf-t', resolve)

    expect(syncChangesWorkflow(before, after)).toBe(true)
  })

  it('ignores canvas-only presentation, as the comparison view does', () => {
    const before = state('return 1', 't-b1')
    const after = projectSyncSource(
      state('return 1', 'b1', { horizontalHandles: false }),
      before,
      'wf-t',
      resolve
    )

    expect(syncChangesWorkflow(before, after)).toBe(false)
  })

  it('always reports a change for a workflow the sync creates', () => {
    expect(syncChangesWorkflow(null, state('return 1'))).toBe(true)
  })
})
