import { describe, expect, it } from 'vitest'
import type { SerializableExecutionState } from '@/executor/execution/types'
import { previewRunFromBlock } from '@/executor/utils/run-from-block-preview'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

function block(id: string, type = 'function'): SerializedBlock {
  return {
    id,
    position: { x: 0, y: 0 },
    config: { tool: '', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: type, name: `${id} name` },
    enabled: true,
  }
}

function snapshot(executedBlocks: string[] = []): SerializableExecutionState {
  return {
    blockStates: Object.fromEntries(
      executedBlocks.map((id) => [
        id,
        { output: { result: 'private value' }, executed: true, executionTime: 1 },
      ])
    ),
    executedBlocks,
    blockLogs: [],
    decisions: { router: {}, condition: {} },
    completedLoops: [],
    activeExecutionPath: [],
  }
}

function workflow(): SerializedWorkflow {
  return {
    version: '1',
    blocks: [
      block('start', 'starter'),
      block('upstream'),
      block('retry'),
      block('sibling'),
      block('join'),
      block('unrelated'),
    ],
    connections: [
      { source: 'start', target: 'upstream' },
      { source: 'upstream', target: 'retry' },
      { source: 'retry', target: 'join' },
      { source: 'sibling', target: 'join' },
    ],
    loops: {},
  }
}

describe('partial-run preview with the real DAG builder', () => {
  it('includes rerun candidates and sibling cached dependencies without exposing values or mutating state', () => {
    const graph = workflow()
    const source = snapshot(['start', 'upstream', 'sibling', 'retry'])
    const before = structuredClone({ graph, source })
    const result = previewRunFromBlock(graph, 'retry', source)

    expect(result.validation).toEqual({ valid: true })
    expect(result.rerunBlocks.map((item) => item.blockId)).toEqual(['retry', 'join'])
    expect(result.rerunBlocks[0].executedInSource).toBe(true)
    expect(result.upstreamBlocks.map((item) => item.blockId)).toEqual([
      'start',
      'upstream',
      'sibling',
    ])
    expect(result.upstreamBlocks.every((item) => item.hasCachedOutput)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private value')
    expect({ graph, source }).toEqual(before)
  })

  it('reports an unexecuted immediate dependency while still showing the candidate graph', () => {
    const result = previewRunFromBlock(workflow(), 'retry', snapshot(['start']))
    expect(result.validation).toEqual({
      valid: false,
      error: 'Upstream dependency not executed: upstream',
    })
    expect(result.upstreamBlocks.find((item) => item.blockId === 'upstream')).toMatchObject({
      executedInSource: false,
      hasCachedOutput: false,
    })
    expect(result.rerunBlocks.map((item) => item.blockId)).toEqual(['retry', 'join'])
  })

  it('distinguishes recorded execution from output availability and excludes disabled downstream blocks', () => {
    const graph = workflow()
    graph.blocks.find((item) => item.id === 'join')!.enabled = false
    const source = snapshot(['upstream'])
    source.blockStates = {}
    const result = previewRunFromBlock(graph, 'retry', source)
    expect(result.validation.valid).toBe(true)
    expect(result.rerunBlocks.map((item) => item.blockId)).toEqual(['retry'])
    expect(result.upstreamBlocks.find((item) => item.blockId === 'upstream')).toMatchObject({
      executedInSource: true,
      hasCachedOutput: false,
    })
  })

  it('shows recorded ancestors across disabled blocks without inventing cached outputs', () => {
    const graph = workflow()
    graph.blocks.find((item) => item.id === 'retry')!.enabled = false
    const result = previewRunFromBlock(graph, 'join', snapshot(['start', 'upstream']))

    expect(result.validation.valid).toBe(true)
    expect(result.rerunBlocks.map((item) => item.blockId)).toEqual(['join'])
    expect(result.upstreamBlocks.find((item) => item.blockId === 'upstream')).toMatchObject({
      executedInSource: true,
      hasCachedOutput: true,
    })
    expect(result.upstreamBlocks.find((item) => item.blockId === 'retry')).toMatchObject({
      executedInSource: false,
      hasCachedOutput: false,
    })
    expect(result.upstreamBlocks.find((item) => item.blockId === 'sibling')).toMatchObject({
      executedInSource: false,
      hasCachedOutput: false,
    })
    expect(result.upstreamBlocks.some((item) => item.blockId === 'unrelated')).toBe(false)
  })

  it('does not change cached ancestors when an unrelated block is disabled', () => {
    const graph = workflow()
    graph.blocks.push(block('note', 'note'))
    graph.connections.push(
      { source: 'unrelated', target: 'note' },
      { source: 'note', target: 'join' }
    )
    const source = snapshot(['start', 'upstream', 'sibling', 'unrelated'])
    const before = previewRunFromBlock(graph, 'retry', source)

    graph.blocks.push({ ...block('disabled'), enabled: false })
    graph.connections.push({ source: 'unrelated', target: 'disabled' })
    expect(previewRunFromBlock(graph, 'retry', source)).toEqual(before)
    expect(before.upstreamBlocks.some((item) => item.blockId === 'unrelated')).toBe(false)
  })

  it.each(['loop', 'parallel'] as const)(
    'projects %s sentinels to containers and refuses interior starts',
    (kind) => {
      const graph: SerializedWorkflow = {
        version: '1',
        blocks: [
          block('start', 'starter'),
          block('container', kind),
          block('inner'),
          block('after'),
        ],
        connections: [
          { source: 'start', target: 'container' },
          { source: 'container', target: 'inner', sourceHandle: `${kind}-start-source` },
          { source: 'container', target: 'after', sourceHandle: `${kind}-end-source` },
        ],
        loops:
          kind === 'loop'
            ? { container: { id: 'container', nodes: ['inner'], iterations: 2 } }
            : {},
        parallels:
          kind === 'parallel' ? { container: { id: 'container', nodes: ['inner'], count: 2 } } : {},
      }
      const result = previewRunFromBlock(graph, 'container', snapshot(['start']))
      expect(result.validation.valid).toBe(true)
      expect(result.rerunBlocks.map((item) => item.blockId)).toEqual([
        'container',
        'inner',
        'after',
      ])
      expect(previewRunFromBlock(graph, 'inner', snapshot()).validation.valid).toBe(false)
      const after = previewRunFromBlock(graph, 'after', snapshot(['container', 'inner₍0₎']))
      expect(
        after.upstreamBlocks.find((item) => item.blockId === 'container')?.hasCachedOutput
      ).toBe(true)
      expect(after.upstreamBlocks.find((item) => item.blockId === 'inner')?.hasCachedOutput).toBe(
        true
      )
      graph.blocks.push({ ...block('disabled'), enabled: false })
      expect(previewRunFromBlock(graph, 'after', snapshot(['container', 'inner₍0₎']))).toEqual(
        after
      )
    }
  )

  it('includes both conditional branches as candidates', () => {
    const graph: SerializedWorkflow = {
      version: '1',
      blocks: [block('condition', 'condition'), block('yes'), block('no')],
      connections: [
        { source: 'condition', target: 'yes', sourceHandle: 'condition-if' },
        { source: 'condition', target: 'no', sourceHandle: 'condition-else' },
      ],
      loops: {},
    }
    expect(
      previewRunFromBlock(graph, 'condition', snapshot()).rerunBlocks.map((item) => item.blockId)
    ).toEqual(['condition', 'yes', 'no'])
  })
})
