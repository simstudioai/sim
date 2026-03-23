/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getTargetedLayoutChangeSet,
  getTargetedLayoutImpact,
} from '@/lib/workflows/autolayout/change-set'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

function createBlock(
  id: string,
  overrides: Partial<BlockState> = {},
  parentId?: string
): BlockState {
  return {
    id,
    type: 'agent',
    name: id,
    position: { x: 100, y: 100 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...(parentId ? { data: { parentId, extent: 'parent' as const } } : {}),
    ...overrides,
  }
}

function createWorkflowState({
  blocks,
  edges = [],
}: {
  blocks: Record<string, BlockState>
  edges?: WorkflowState['edges']
}): Pick<WorkflowState, 'blocks' | 'edges'> {
  return {
    blocks,
    edges,
  }
}

describe('getTargetedLayoutChangeSet', () => {
  it('includes newly added blocks', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        agent: createBlock('agent', { position: { x: 400, y: 100 } }),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual(['agent'])
  })

  it('keeps subblock-only edits anchored', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start', {
          subBlocks: {
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'updated',
            },
          },
        }),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
  })

  it('reopens only the downstream path when an edge is added later', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        function1: createBlock('function1', { position: { x: 400, y: 100 } }),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'function1',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        function1: createBlock('function1', { position: { x: 400, y: 100 } }),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'function1',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-2',
          source: 'start',
          target: 'function1',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: ['function1'],
      shiftSourceBlockIds: [],
    })
  })

  it('keeps the upstream source anchored when inserting between existing blocks', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
        inserted: createBlock('inserted', { position: { x: 400, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'start',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
        inserted: createBlock('inserted', { position: { x: 400, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-2',
          source: 'start',
          target: 'inserted',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-3',
          source: 'inserted',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: ['inserted'],
      shiftSourceBlockIds: ['inserted'],
    })
  })

  it('ignores edge changes that cross layout scopes', () => {
    const before = createWorkflowState({
      blocks: {
        loop: createBlock('loop'),
        child: createBlock('child', { position: { x: 120, y: 160 } }, 'loop'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        loop: createBlock('loop'),
        child: createBlock('child', { position: { x: 120, y: 160 } }, 'loop'),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'loop',
          target: 'child',
          sourceHandle: 'loop-start-source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
  })
})
