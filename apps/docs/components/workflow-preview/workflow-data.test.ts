/**
 * @vitest-environment node
 */
import { BLOCK_Z_BASE, CONTAINER_CHILD_Z_BASE, getEdgeZIndex } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import * as academyWorkflows from '@/components/workflow-preview/academy-video-workflows'
import { BLOCK_DISPLAY_WORKFLOWS } from '@/components/workflow-preview/block-display-workflows'
import * as exampleWorkflows from '@/components/workflow-preview/examples'
import {
  type PreviewBlock,
  type PreviewWorkflow,
  toReactFlowElements,
} from '@/components/workflow-preview/workflow-data'

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

describe('authored canvas presentation', () => {
  const workflows = [
    ...Object.values(exampleWorkflows),
    ...Object.values(academyWorkflows),
    ...Object.values(BLOCK_DISPLAY_WORKFLOWS),
  ]

  it('keeps sentence slots connected to example values or named empty states', () => {
    for (const workflow of workflows) {
      for (const block of workflow.blocks) {
        expect(block.typeLabel, `${workflow.id}/${block.id}`).toBeTruthy()
        if (block.size || block.branches) continue
        expect(block.sentence?.length, `${workflow.id}/${block.id}`).toBeGreaterThan(0)
        for (const segment of block.sentence ?? []) {
          if (typeof segment === 'string') continue
          expect(
            Boolean(segment.noun) ||
              block.rows.some((row) => row.title === segment.subBlockId) ||
              (segment.subBlockId === 'Tools' && Boolean(block.tools?.length)),
            `${workflow.id}/${block.id}/${segment.subBlockId}`
          ).toBe(true)
        }
      }
    }
  })

  it('renders an error port exactly when the authored workflow connects that output', () => {
    for (const workflow of workflows) {
      const { nodes } = toReactFlowElements(workflow)
      for (const node of nodes.filter((node) => node.type === 'previewBlock')) {
        expect(node.data.hasErrorConnection).toBe(
          workflow.edges.some((edge) => edge.source === node.id && edge.sourceHandle === 'error')
        )
      }
    }
  })
})

describe('authored diagram focus', () => {
  it('keeps every node visible when no step is emphasized', () => {
    const { nodes } = toReactFlowElements(workflow)
    expect(nodes.every((node) => !node.data.isDimmed)).toBe(true)
  })

  it('de-emphasizes surrounding cards and containers for a highlighted step', () => {
    const { nodes } = toReactFlowElements(workflow, false, { highlightBlock: 'agent' })
    expect(nodes.filter((node) => node.data.isDimmed).map((node) => node.id)).toEqual([
      'start',
      'loop',
      'parallel',
    ])
    expect(nodes.find((node) => node.id === 'agent')?.data.isHighlighted).toBe(true)
  })

  it('keeps both the authored focus and inspected block at full emphasis', () => {
    const { nodes } = toReactFlowElements(workflow, false, {
      highlightBlock: 'agent',
      selectedBlock: 'loop',
    })
    expect(nodes.filter((node) => !node.data.isDimmed).map((node) => node.id)).toEqual([
      'loop',
      'agent',
    ])
  })

  it('de-emphasizes nodes when the illustration focuses on an edge', () => {
    const { nodes, edges } = toReactFlowElements(workflow, false, {
      highlightEdge: 'loop-agent',
    })
    expect(nodes.every((node) => node.data.isDimmed)).toBe(true)
    expect(edges.find((edge) => edge.id === 'loop-agent')?.style?.opacity).toBe(1)
    expect(edges.find((edge) => edge.id === 'start-loop')?.style?.opacity).toBeLessThan(1)
  })
})
