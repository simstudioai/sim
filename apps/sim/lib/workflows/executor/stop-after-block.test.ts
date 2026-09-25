import {
  blocksMock,
  createBlock,
  createFunctionBlock,
  createStarterBlock,
  toolsMetadataMock,
  toolsUtilsMock,
} from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { validateStopAfterBlock } from '@/lib/workflows/executor/stop-after-block'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/blocks', () => blocksMock)
vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@/tools/metadata', () => toolsMetadataMock)

function state(): Pick<WorkflowState, 'blocks' | 'edges' | 'loops' | 'parallels'> {
  return {
    blocks: {
      start: createStarterBlock({ id: 'start' }),
      formatter: createFunctionBlock({ id: 'formatter' }),
      publish: createFunctionBlock({ id: 'publish' }),
      detached: createFunctionBlock({ id: 'detached' }),
    },
    edges: [
      { id: 'a', source: 'start', target: 'formatter' },
      { id: 'b', source: 'formatter', target: 'publish' },
    ],
    loops: {},
    parallels: {},
  }
}

describe('stop-after target validation with the real serializer and DAG', () => {
  it('accepts a reachable top-level target without mutating saved state', () => {
    const graph = state()
    const before = structuredClone(graph)
    expect(() => validateStopAfterBlock(graph, 'formatter', 'start')).not.toThrow()
    expect(graph).toEqual(before)
  })

  it('rejects missing, disabled and unreachable targets', () => {
    const graph = state()
    expect(() => validateStopAfterBlock(graph, 'missing', 'start')).toThrow('enabled block')
    expect(() => validateStopAfterBlock(graph, 'detached', 'start')).toThrow('not reachable')
    graph.blocks.formatter.enabled = false
    expect(() => validateStopAfterBlock(graph, 'formatter', 'start')).toThrow('enabled block')
  })

  it('requires partial-run stops to be in the rerun set, including disconnected partial runs', () => {
    const graph = state()
    expect(() => validateStopAfterBlock(graph, 'formatter', undefined, 'publish')).toThrow(
      'not reachable'
    )
    expect(() => validateStopAfterBlock(graph, 'publish', undefined, 'formatter')).not.toThrow()
    expect(() => validateStopAfterBlock(graph, 'detached', undefined, 'detached')).not.toThrow()
  })

  it('requires the resolved entry instead of selecting another trigger by graph order', () => {
    const graph = state()
    graph.blocks = {
      webhook: createBlock({ id: 'webhook', type: 'webhook' }),
      ...graph.blocks,
    }
    graph.edges.push({ id: 'c', source: 'webhook', target: 'detached' })

    expect(() => validateStopAfterBlock(graph, 'formatter')).toThrow('resolved trigger')
    expect(() => validateStopAfterBlock(graph, 'detached')).toThrow('resolved trigger')
    expect(() => validateStopAfterBlock(graph, 'formatter', 'start')).not.toThrow()
    expect(() => validateStopAfterBlock(graph, 'detached', 'start')).toThrow('not reachable')
    expect(() => validateStopAfterBlock(graph, 'detached', 'webhook')).not.toThrow()
  })

  it.each(['loop', 'parallel'] as const)(
    'allows the %s container and rejects its interior',
    (kind) => {
      const graph = state()
      graph.blocks.container = createBlock({ id: 'container', type: kind })
      graph.blocks.formatter.data = { parentId: 'container', extent: 'parent' }
      graph.edges = [
        { id: 'a', source: 'start', target: 'container' },
        { id: 'b', source: 'container', target: 'formatter', sourceHandle: `${kind}-start-source` },
        { id: 'c', source: 'container', target: 'publish', sourceHandle: `${kind}-end-source` },
      ]
      if (kind === 'loop')
        graph.loops = {
          container: { id: 'container', nodes: ['formatter'], iterations: 2, loopType: 'for' },
        }
      else
        graph.parallels = {
          container: { id: 'container', nodes: ['formatter'], count: 2, parallelType: 'count' },
        }
      expect(() => validateStopAfterBlock(graph, 'container', 'start')).not.toThrow()
      expect(() => validateStopAfterBlock(graph, 'formatter', 'start')).toThrow(
        /inside a loop or parallel|not reachable/
      )
    }
  )
})
