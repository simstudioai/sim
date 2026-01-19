/**
 * @vitest-environment node
 */

import type { Edge } from 'reactflow'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.mock('@/stores/workflows/utils', () => ({
  mergeSubblockState: vi.fn(),
}))

import { mergeSubblockState } from '@/stores/workflows/utils'
import { captureLatestEdges, captureLatestSubBlockValues } from './utils'

const mockMergeSubblockState = mergeSubblockState as Mock

describe('captureLatestEdges', () => {
  const createEdge = (id: string, source: string, target: string): Edge => ({
    id,
    source,
    target,
  })

  it('should return edges where blockId is the source', () => {
    const edges = [
      createEdge('edge-1', 'block-1', 'block-2'),
      createEdge('edge-2', 'block-3', 'block-4'),
    ]

    const result = captureLatestEdges(edges, ['block-1'])

    expect(result).toEqual([createEdge('edge-1', 'block-1', 'block-2')])
  })

  it('should return edges where blockId is the target', () => {
    const edges = [
      createEdge('edge-1', 'block-1', 'block-2'),
      createEdge('edge-2', 'block-3', 'block-4'),
    ]

    const result = captureLatestEdges(edges, ['block-2'])

    expect(result).toEqual([createEdge('edge-1', 'block-1', 'block-2')])
  })

  it('should return edges for multiple blocks', () => {
    const edges = [
      createEdge('edge-1', 'block-1', 'block-2'),
      createEdge('edge-2', 'block-3', 'block-4'),
      createEdge('edge-3', 'block-2', 'block-5'),
    ]

    const result = captureLatestEdges(edges, ['block-1', 'block-2'])

    expect(result).toHaveLength(2)
    expect(result).toContainEqual(createEdge('edge-1', 'block-1', 'block-2'))
    expect(result).toContainEqual(createEdge('edge-3', 'block-2', 'block-5'))
  })

  it('should return empty array when no edges match', () => {
    const edges = [
      createEdge('edge-1', 'block-1', 'block-2'),
      createEdge('edge-2', 'block-3', 'block-4'),
    ]

    const result = captureLatestEdges(edges, ['block-99'])

    expect(result).toEqual([])
  })

  it('should return empty array when blockIds is empty', () => {
    const edges = [
      createEdge('edge-1', 'block-1', 'block-2'),
      createEdge('edge-2', 'block-3', 'block-4'),
    ]

    const result = captureLatestEdges(edges, [])

    expect(result).toEqual([])
  })

  it('should return edge when block has both source and target edges', () => {
    const edges = [
      createEdge('edge-1', 'block-1', 'block-2'),
      createEdge('edge-2', 'block-2', 'block-3'),
      createEdge('edge-3', 'block-4', 'block-2'),
    ]

    const result = captureLatestEdges(edges, ['block-2'])

    expect(result).toHaveLength(3)
    expect(result).toContainEqual(createEdge('edge-1', 'block-1', 'block-2'))
    expect(result).toContainEqual(createEdge('edge-2', 'block-2', 'block-3'))
    expect(result).toContainEqual(createEdge('edge-3', 'block-4', 'block-2'))
  })

  it('should handle empty edges array', () => {
    const result = captureLatestEdges([], ['block-1'])

    expect(result).toEqual([])
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should capture single block with single subblock value', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'console.log("hello")' },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': { code: 'console.log("hello")' },
    })
  })

  it('should capture single block with multiple subblock values', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'test code' },
        model: { id: 'model', type: 'dropdown', value: 'gpt-4' },
        temperature: { id: 'temperature', type: 'slider', value: 0.7 },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': {
        code: 'test code',
        model: 'gpt-4',
        temperature: 0.7,
      },
    })
  })

  it('should capture multiple blocks with values', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'code 1' },
      }),
      'block-2': createBlockState('block-2', {
        prompt: { id: 'prompt', type: 'long-input', value: 'hello world' },
      }),
    }

    mockMergeSubblockState.mockImplementation((_blocks, _wfId, blockId) => {
      if (blockId === 'block-1') return { 'block-1': blocks['block-1'] }
      if (blockId === 'block-2') return { 'block-2': blocks['block-2'] }
      return {}
    })

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1', 'block-2'])

    expect(result).toEqual({
      'block-1': { code: 'code 1' },
      'block-2': { prompt: 'hello world' },
    })
  })

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

  it('should skip undefined values', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'valid code' },
        empty: { id: 'empty', type: 'short-input', value: undefined },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': { code: 'valid code' },
    })
  })

  it('should return empty object for block with no subBlocks', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': {
        id: 'block-1',
        type: 'function',
        name: 'Test Block',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      } as BlockState,
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({})
  })

  it('should return empty object for non-existent blockId', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'test' },
      }),
    }

    mockMergeSubblockState.mockReturnValue({})

    const result = captureLatestSubBlockValues(blocks, workflowId, ['non-existent'])

    expect(result).toEqual({})
  })

  it('should return empty object when blockIds is empty', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: 'test' },
      }),
    }

    const result = captureLatestSubBlockValues(blocks, workflowId, [])

    expect(result).toEqual({})
    expect(mockMergeSubblockState).not.toHaveBeenCalled()
  })

  it('should handle various value types (string, number, array)', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        text: { id: 'text', type: 'short-input', value: 'string value' },
        number: { id: 'number', type: 'slider', value: 42 },
        array: {
          id: 'array',
          type: 'table',
          value: [
            ['a', 'b'],
            ['c', 'd'],
          ],
        },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': {
        text: 'string value',
        number: 42,
        array: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
    })
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

  it('should handle block without subBlocks property', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': {
        id: 'block-1',
        type: 'function',
        name: 'Test Block',
        position: { x: 0, y: 0 },
        outputs: {},
        enabled: true,
      } as BlockState,
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({})
  })

  it('should handle empty string values', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': createBlockState('block-1', {
        code: { id: 'code', type: 'code', value: '' },
      }),
    }

    mockMergeSubblockState.mockReturnValue(blocks)

    const result = captureLatestSubBlockValues(blocks, workflowId, ['block-1'])

    expect(result).toEqual({
      'block-1': { code: '' },
    })
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
