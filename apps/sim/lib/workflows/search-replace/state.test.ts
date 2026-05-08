/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getWorkflowSearchBlocks } from '@/lib/workflows/search-replace/state'
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

  it('uses merged live subblock values for normal workflow search', () => {
    const result = getWorkflowSearchBlocks({
      blocks,
      isSnapshotView: false,
      subblockValues: {
        block1: { code: 'Hello' },
      },
    })

    expect(result.block1.subBlocks.code.value).toBe('Hello')
  })

  it('does not merge snapshot blocks', () => {
    const result = getWorkflowSearchBlocks({
      blocks,
      isSnapshotView: true,
      subblockValues: {
        block1: { code: 'Hello' },
      },
    })

    expect(result).toBe(blocks)
  })
})
