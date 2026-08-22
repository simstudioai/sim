/**
 * @vitest-environment node
 */
import { HANDLE_POSITIONS } from '@sim/workflow-renderer'
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

  it('aligns an error branch to the source block bottom using the painted height', () => {
    // The source's height comes from layout.measuredHeight, not the raw height
    // field, so an error handle offset read off block.height would fall back to
    // MIN_HEIGHT and place the error branch near the block's top instead.
    const source = {
      ...createBlock('source'),
      height: undefined,
      layout: { measuredWidth: 250, measuredHeight: 400 },
    } as BlockState

    const blocks: Record<string, BlockState> = {
      source,
      ok: createBlock('ok'),
      failed: createBlock('failed'),
    }
    const edges: Edge[] = [
      { id: 'e1', source: 'source', target: 'ok' },
      { id: 'e2', source: 'source', target: 'failed', sourceHandle: 'error' },
    ]

    const { nodes } = layoutBlocksCore(blocks, edges, { isContainer: false })
    const sourceNode = nodes.get('source')!

    // The error branch's centered target lines up with the source's bottom-edge error handle.
    const failedNode = nodes.get('failed')!
    const errorHandleY = sourceNode.position.y + sourceNode.metrics.portHeight
    expect(failedNode.position.y + failedNode.metrics.portHeight / 2).toBe(errorHandleY)
    expect(nodes.get('ok')!.position.y).toBeLessThan(nodes.get('failed')!.position.y)
  })

  it('centres a port on the painted height, not the padded spacing height', () => {
    /*
     * The spacing height is deliberately biased tall for blocks whose estimate
     * exceeds their measurement. Ports are centred, so feeding that padded
     * number into the centring would drop the card by half the padding and put
     * a visible kink in every edge reaching it — the failure the old fixed
     * top-anchored offset could not have, because height cancelled out of
     * `y = sourceHandleY - offset` entirely.
     */
    const padded = {
      ...createBlock('padded'),
      height: 137,
      layout: { measuredWidth: 250, measuredHeight: 137 },
      subBlocks: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          `field-${index}`,
          { id: `field-${index}`, type: 'short-input', value: '' },
        ])
      ),
    } as unknown as BlockState

    const blocks: Record<string, BlockState> = { source: createBlock('source'), padded }
    const edges: Edge[] = [{ id: 'e1', source: 'source', target: 'padded' }]

    const { nodes } = layoutBlocksCore(blocks, edges, { isContainer: false })
    const sourceNode = nodes.get('source')!
    const paddedNode = nodes.get('padded')!

    expect(paddedNode.metrics.height).toBeGreaterThan(paddedNode.metrics.portHeight)
    expect(paddedNode.metrics.portHeight).toBe(137)
    expect(paddedNode.position.y + paddedNode.metrics.portHeight / 2).toBe(
      sourceNode.position.y + sourceNode.metrics.portHeight / 2
    )
  })

  it('anchors a subflow container on the port the renderer actually paints', () => {
    /*
     * A loop/parallel container's input and output sit on the centre of its
     * inset Start card, a fixed offset from the container's top — not at its
     * vertical centre like a regular card, and not at the old 20px default.
     * Auto-layout aligning to anything else tilts every edge into and out of
     * every container, which is invisible to a uniform-height fixture.
     */
    const container = {
      ...createBlock('loop-1'),
      type: 'loop',
      height: 300,
      layout: { measuredWidth: 500, measuredHeight: 300 },
    } as BlockState

    const blocks: Record<string, BlockState> = {
      'loop-1': container,
      after: createBlock('after'),
    }
    const edges: Edge[] = [
      { id: 'e1', source: 'loop-1', target: 'after', sourceHandle: 'loop-end-source' },
    ]

    const { nodes } = layoutBlocksCore(blocks, edges, { isContainer: false })
    const containerNode = nodes.get('loop-1')!
    const afterNode = nodes.get('after')!

    const containerPortY = containerNode.position.y + HANDLE_POSITIONS.SUBFLOW_CONNECTION_Y
    expect(afterNode.position.y + afterNode.metrics.portHeight / 2).toBe(containerPortY)
  })

  it('keeps an unparented block inside the layout padding', () => {
    /*
     * With no positioned predecessor there is no handle to align to. The
     * fallback anchor and the offset subtracted from it have to use the same
     * convention, or a tall block lands above the padding — and above its own
     * container when it has one.
     */
    const tall = {
      ...createBlock('tall'),
      height: 400,
      layout: { measuredWidth: 250, measuredHeight: 400 },
    } as BlockState

    const blocks: Record<string, BlockState> = { root: createBlock('root'), tall }
    const edges: Edge[] = [{ id: 'e1', source: 'missing-source', target: 'tall' }]

    const { nodes } = layoutBlocksCore(blocks, edges, { isContainer: false })

    expect(nodes.get('tall')!.position.y).toBeGreaterThanOrEqual(0)
  })
})
