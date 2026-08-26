/**
 * @vitest-environment node
 */
import { BLOCK_Z_BASE, CONTAINER_CHILD_Z_BASE, getEdgeZIndex } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import { type PreviewBlock, type PreviewWorkflow, toReactFlowElements } from './workflow-data'

const block = (
  overrides: Partial<PreviewBlock> & Pick<PreviewBlock, 'id' | 'type'>
): PreviewBlock => ({
  name: overrides.id,
  bgColor: '#000000',
  rows: [],
  position: { x: 0, y: 0 },
  ...overrides,
})

const workflow: PreviewWorkflow = {
  id: 'nested-subflows',
  name: 'Nested subflows',
  blocks: [
    block({ id: 'start', type: 'starter' }),
    block({ id: 'loop', type: 'loop', size: { width: 500, height: 300 } }),
    block({
      id: 'parallel',
      type: 'parallel',
      parentId: 'loop',
      position: { x: 24, y: 64 },
      size: { width: 400, height: 200 },
    }),
    block({ id: 'agent', type: 'agent', parentId: 'loop', position: { x: 24, y: 140 } }),
  ],
  edges: [
    { id: 'start-loop', source: 'start', target: 'loop' },
    { id: 'loop-parallel', source: 'loop', target: 'parallel' },
    { id: 'loop-agent', source: 'loop', target: 'agent' },
  ],
}

describe('toReactFlowElements layering', () => {
  it('places incoming edges on their container target layer', () => {
    const { nodes, edges } = toReactFlowElements(workflow, false, {
      highlightEdge: 'loop-parallel',
    })
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]))

    expect(nodeById.get('loop')?.zIndex).toBe(0)
    expect(nodeById.get('parallel')?.zIndex).toBe(1)
    expect(edgeById.get('start-loop')?.zIndex).toBe(0)
    expect(edgeById.get('loop-parallel')?.zIndex).toBe(1)
  })

  it('keeps ordinary cards above normally layered edges', () => {
    const { nodes, edges } = toReactFlowElements(workflow)
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]))

    expect(nodeById.get('start')?.zIndex).toBe(BLOCK_Z_BASE)
    expect(nodeById.get('agent')?.zIndex).toBe(CONTAINER_CHILD_Z_BASE)
    expect(edgeById.get('loop-agent')?.zIndex).toBe(getEdgeZIndex(0))
  })
})
