import { describe, expect, it } from 'vitest'
import { isBlockInActiveExecutionHandoff } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-execution-handoff'

const edges = [
  { id: 'source-to-target', source: 'source', target: 'target' },
  { id: 'stale-to-target', source: 'stale-source', target: 'target' },
  { id: 'source-to-idle', source: 'source', target: 'idle-target' },
]

describe('isBlockInActiveExecutionHandoff', () => {
  it('highlights the active destination and the source that just delivered it', () => {
    const options = {
      isExecuting: true,
      activeBlockIds: new Set(['target']),
      lastRunEdges: new Map([['source-to-target', 'success']]),
      edges,
    }

    expect(isBlockInActiveExecutionHandoff({ ...options, blockId: 'target' })).toBe(true)
    expect(isBlockInActiveExecutionHandoff({ ...options, blockId: 'source' })).toBe(true)
  })

  it('does not highlight unrelated sources or previously traversed inactive paths', () => {
    const options = {
      isExecuting: true,
      activeBlockIds: new Set(['target']),
      lastRunEdges: new Map([
        ['source-to-target', 'success'],
        ['source-to-idle', 'success'],
      ]),
      edges,
    }

    expect(isBlockInActiveExecutionHandoff({ ...options, blockId: 'stale-source' })).toBe(false)
    expect(isBlockInActiveExecutionHandoff({ ...options, blockId: 'idle-target' })).toBe(false)
  })

  it('clears every handoff highlight when execution stops', () => {
    expect(
      isBlockInActiveExecutionHandoff({
        blockId: 'target',
        isExecuting: false,
        activeBlockIds: new Set(['target']),
        lastRunEdges: new Map([['source-to-target', 'success']]),
        edges,
      })
    ).toBe(false)
  })

  it('recomputes the handoff when the execution snapshot changes', () => {
    expect(
      isBlockInActiveExecutionHandoff({
        blockId: 'source',
        isExecuting: true,
        activeBlockIds: new Set(['target']),
        lastRunEdges: new Map([['source-to-target', 'success']]),
        edges,
      })
    ).toBe(true)

    expect(
      isBlockInActiveExecutionHandoff({
        blockId: 'source',
        isExecuting: true,
        activeBlockIds: new Set(['idle-target']),
        lastRunEdges: new Map(),
        edges,
      })
    ).toBe(false)
  })
})
