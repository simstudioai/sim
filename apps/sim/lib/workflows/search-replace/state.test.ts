/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getWorkflowSearchBlocks } from '@/lib/workflows/search-replace/state'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

describe('getWorkflowSearchBlocks', () => {
  const blocks = {
    block1: {
      id: 'block1',
      type: 'function',
      name: 'Function 1',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        code: { id: 'code', type: 'code', value: '' },
      },
    },
  } as Record<string, BlockState>

  beforeEach(() => {
    useSubBlockStore.setState({ workflowValues: {} })
  })

  it('uses merged live subblock values for normal workflow search', () => {
    useSubBlockStore.getState().setWorkflowValues('workflow-1', {
      block1: { code: 'Hello' },
    })

    const result = getWorkflowSearchBlocks({
      blocks,
      workflowId: 'workflow-1',
      isSnapshotView: false,
    })

    expect(result.block1.subBlocks.code.value).toBe('Hello')
  })

  it('does not merge snapshot blocks', () => {
    const result = getWorkflowSearchBlocks({
      blocks,
      workflowId: 'workflow-1',
      isSnapshotView: true,
    })

    expect(result).toBe(blocks)
  })
})
