/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { applyTargetedLayout } from '@/lib/workflows/autolayout/targeted'
import type { Edge } from '@/lib/workflows/autolayout/types'
import { getBlockMetrics } from '@/lib/workflows/autolayout/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

function createBlock(id: string, overrides: Partial<BlockState> = {}): BlockState {
  return {
    id,
    type: 'function',
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  }
}

describe('applyTargetedLayout', () => {
  it('shifts downstream frozen blocks when only shift sources are provided', () => {
    const blocks = {
      source: createBlock('source', {
        position: { x: 100, y: 100 },
      }),
      target: createBlock('target', {
        position: { x: 400, y: 100 },
      }),
      end: createBlock('end', {
        position: { x: 760, y: 100 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'source',
        target: 'target',
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        id: 'edge-2',
        source: 'target',
        target: 'end',
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: [],
      shiftSourceBlockIds: ['source'],
    })

    expect(result.source.position).toEqual({ x: 100, y: 100 })
    expect(result.target.position).toEqual({ x: 530, y: 100 })
    expect(result.end.position).toEqual({ x: 960, y: 100 })
  })

  it('places new linear blocks without moving anchors', () => {
    const blocks = {
      anchor: createBlock('anchor', {
        position: { x: 150, y: 150 },
      }),
      changed: createBlock('changed', {
        position: { x: 0, y: 0 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'anchor',
        target: 'changed',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: ['changed'],
    })

    expect(result.anchor.position).toEqual({ x: 150, y: 150 })
    expect(result.changed.position.x).toBeGreaterThan(result.anchor.position.x)
    expect(result.changed.position.y).toBe(result.anchor.position.y)
  })

  it('keeps root-level insertions closer to anchored blocks near the top of the canvas', () => {
    const blocks = {
      start: createBlock('start', {
        position: { x: 0, y: 0 },
      }),
      changed: createBlock('changed', {
        position: { x: 0, y: 0 },
      }),
      agent: createBlock('agent', {
        position: { x: 410.94, y: 2.33 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'start',
        target: 'changed',
      },
      {
        id: 'edge-2',
        source: 'changed',
        target: 'agent',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: ['changed'],
    })

    expect(result.changed.position.y).toBeLessThan(150)
  })

  it('places new parallel children below tall anchored siblings', () => {
    const blocks = {
      parallel: createBlock('parallel', {
        type: 'parallel',
        position: { x: 200, y: 150 },
        data: { width: 600, height: 500 },
        layout: { measuredWidth: 600, measuredHeight: 500 },
      }),
      existing: createBlock('existing', {
        position: { x: 180, y: 100 },
        data: { parentId: 'parallel', extent: 'parent' },
        layout: { measuredWidth: 250, measuredHeight: 220 },
        height: 220,
      }),
      changed: createBlock('changed', {
        position: { x: 0, y: 0 },
        data: { parentId: 'parallel', extent: 'parent' },
      }),
    }

    const result = applyTargetedLayout(blocks, [], {
      changedBlockIds: ['changed'],
    })

    const existingMetrics = getBlockMetrics(result.existing)
    expect(result.parallel.position).toEqual({ x: 200, y: 150 })
    expect(result.changed.position.y).toBeGreaterThanOrEqual(
      result.existing.position.y + existingMetrics.height
    )
  })
})
