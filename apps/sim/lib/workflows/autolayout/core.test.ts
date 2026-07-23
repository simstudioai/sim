/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { layoutBlocksCore } from '@/lib/workflows/autolayout/core'
import type { Edge } from '@/lib/workflows/autolayout/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.mock('@/blocks', () => ({
  getBlock: () => null,
}))

function createBlock(id: string): BlockState {
  return {
    id,
    type: 'agent',
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    height: 120,
    layout: { measuredWidth: 250, measuredHeight: 120 },
  } as BlockState
}

describe('layoutBlocksCore', () => {
  it('keeps each branch in a stable row regardless of block insertion order', () => {
    // Two parallel chains from one source. Insertion order is interleaved so the
    // per-layer order flips: layer1 [a1,b1], layer2 [b2,a2], layer3 [a3,b3].
    // Row assignment must come from the resolved predecessor position, not from
    // per-layer insertion-order tie-breaks.
    const blocks: Record<string, BlockState> = {}
    for (const id of ['s', 'a1', 'b1', 'b2', 'a2', 'a3', 'b3']) {
      blocks[id] = createBlock(id)
    }
    const edges: Edge[] = [
      { id: 'e1', source: 's', target: 'a1' },
      { id: 'e2', source: 's', target: 'b1' },
      { id: 'e3', source: 'a1', target: 'a2' },
      { id: 'e4', source: 'b1', target: 'b2' },
      { id: 'e5', source: 'a2', target: 'a3' },
      { id: 'e6', source: 'b2', target: 'b3' },
    ]

    const { nodes } = layoutBlocksCore(blocks, edges, { isContainer: false })
    const y = (id: string) => nodes.get(id)!.position.y

    const aAboveInLayer1 = y('a1') < y('b1')
    expect(y('a2') < y('b2')).toBe(aAboveInLayer1)
    expect(y('a3') < y('b3')).toBe(aAboveInLayer1)
  })

  it('leaves no vertical overlaps within a layer', () => {
    const blocks: Record<string, BlockState> = {}
    for (const id of ['s', 'a1', 'b1', 'c1']) {
      blocks[id] = createBlock(id)
    }
    const edges: Edge[] = [
      { id: 'e1', source: 's', target: 'a1' },
      { id: 'e2', source: 's', target: 'b1' },
      { id: 'e3', source: 's', target: 'c1' },
    ]

    const { nodes } = layoutBlocksCore(blocks, edges, { isContainer: false })
    const layer1 = ['a1', 'b1', 'c1']
      .map((id) => nodes.get(id)!)
      .sort((a, b) => a.position.y - b.position.y)

    for (let i = 0; i < layer1.length - 1; i++) {
      expect(layer1[i + 1].position.y).toBeGreaterThanOrEqual(
        layer1[i].position.y + layer1[i].metrics.height
      )
    }
  })
})
