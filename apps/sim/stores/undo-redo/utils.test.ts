import type { Edge } from '@xyflow/react'
import { describe, expect, it, type Mock, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.mock('@/stores/workflows/utils', () => ({
  mergeSubblockState: vi.fn(),
}))

import { UNDO_REDO_OPERATIONS } from '@sim/realtime-protocol/constants'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { captureLatestEdges, captureLatestSubBlockValues, createInverseOperation } from './utils'

const mockMergeSubblockState = mergeSubblockState as Mock

describe('captureLatestEdges', () => {
  const createEdge = (id: string, source: string, target: string): Edge => ({
    id,
    source,
    target,
  })

  it('should not duplicate edges when block appears in multiple blockIds', () => {
    const edges = [createEdge('edge-1', 'block-1', 'block-2')]

    const result = captureLatestEdges(edges, ['block-1', 'block-2'])

    expect(result).toHaveLength(1)
    expect(result).toContainEqual(createEdge('edge-1', 'block-1', 'block-2'))
  })
})

describe('captureLatestSubBlockValues', () => {
  const workflowId = 'wf-test'

  const createBlockState = (
    id: string,
    subBlocks: Record<string, { id: string; type: string; value: unknown }>
  ): BlockState =>
    ({
      id,
      type: 'function',
      name: 'Test Block',
      position: { x: 0, y: 0 },
      subBlocks: Object.fromEntries(
        Object.entries(subBlocks).map(([subId, sb]) => [
          subId,
          { id: sb.id, type: sb.type, value: sb.value },
        ])
      ),
      outputs: {},
      enabled: true,
    }) as BlockState

  it('should skip null values', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'valid code' },
        empty: { id: 'empty', type: 'short-input', value: null },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': { code: 'valid code' },
    })
    expect(result['block-1']).not.toHaveProperty('empty')
  })

  it('should only capture values for blockIds in the list', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'code 1' },
      }),
      'block-2': createBlockState('block-2', {
        code: { id: 'code', type: 'code', value: 'code 2' },
      }),
      'block-3': createBlockState('block-3', {
        code: { id: 'code', type: 'code', value: 'code 3' },
      }),
    }

    mockMergeSubblockState.mockImplementation((_blocks, _wfId, blockId) => {
      if (blockId === 'block-1') return { 'block-1': blocks['block-1'] }
      if (blockId === 'block-3') return { 'block-3': blocks['block-3'] }
      return {}
    })

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1', 'block-3'])

    expect(result).toEqual({
      'block-1': { code: 'code 1' },
      'block-3': { code: 'code 3' },
    })
    expect(result).not.toHaveProperty('block-2')
  })

  it('should handle zero numeric values', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        temperature: { id: 'temperature', type: 'slider', value: 0 },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': { temperature: 0 },
    })
  })
})

describe('createInverseOperation', () => {
  it('inverts batch subblock updates', () => {
    const operation = {
      id: 'op-1',
      type: UNDO_REDO_OPERATIONS.BATCH_UPDATE_SUBBLOCKS,
      timestamp: 1,
      workflowId: 'workflow-1',
      userId: 'user-1',
      data: {
        updates: [
          {
            blockId: 'block-1',
            subBlockId: 'prompt',
            before: 'old',
            after: 'new',
          },
        ],
        subflowUpdates: [
          {
            blockId: 'loop-1',
            blockType: 'loop',
            fieldId: 'subflowIterations',
            before: 2,
            after: 3,
          },
        ],
      },
    }

    expect(createInverseOperation(operation)).toEqual({
      ...operation,
      data: {
        updates: [
          {
            blockId: 'block-1',
            subBlockId: 'prompt',
            before: 'new',
            after: 'old',
          },
        ],
        subflowUpdates: [
          {
            blockId: 'loop-1',
            blockType: 'loop',
            fieldId: 'subflowIterations',
            before: 3,
            after: 2,
          },
        ],
      },
    })
  })
})
