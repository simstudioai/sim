import type { Edge } from 'reactflow'
import { useExecutionStore } from '@/stores/execution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface ActiveExecutionHandoffOptions {
  blockId: string
  isExecuting: boolean
  activeBlockIds: ReadonlySet<string>
  lastRunEdges: ReadonlyMap<string, unknown>
  edges: ReadonlyArray<Pick<Edge, 'id' | 'source' | 'target'>>
}

interface ActiveExecutionHandoffCache {
  activeBlockIds: ReadonlySet<string>
  lastRunEdges: ReadonlyMap<string, unknown>
  edges: ReadonlyArray<Pick<Edge, 'id' | 'source' | 'target'>>
  highlightedBlockIds: ReadonlySet<string>
}

let activeExecutionHandoffCache: ActiveExecutionHandoffCache | null = null

/** Resolves the active handoff once for every immutable execution snapshot. */
function getActiveExecutionHandoffBlockIds(
  activeBlockIds: ReadonlySet<string>,
  lastRunEdges: ReadonlyMap<string, unknown>,
  edges: ReadonlyArray<Pick<Edge, 'id' | 'source' | 'target'>>
): ReadonlySet<string> {
  if (
    activeExecutionHandoffCache?.activeBlockIds === activeBlockIds &&
    activeExecutionHandoffCache.lastRunEdges === lastRunEdges &&
    activeExecutionHandoffCache.edges === edges
  ) {
    return activeExecutionHandoffCache.highlightedBlockIds
  }

  const highlightedBlockIds = new Set(activeBlockIds)
  for (const edge of edges) {
    if (lastRunEdges.has(edge.id) && activeBlockIds.has(edge.target)) {
      highlightedBlockIds.add(edge.source)
    }
  }

  activeExecutionHandoffCache = {
    activeBlockIds,
    lastRunEdges,
    edges,
    highlightedBlockIds,
  }

  return highlightedBlockIds
}

/**
 * Returns whether a block is participating in the handoff into an active block.
 *
 * The active destination always participates. A source participates only when
 * its outgoing edge has been taken and currently feeds an active destination.
 */
export function isBlockInActiveExecutionHandoff({
  blockId,
  isExecuting,
  activeBlockIds,
  lastRunEdges,
  edges,
}: ActiveExecutionHandoffOptions): boolean {
  if (!isExecuting) return false
  return getActiveExecutionHandoffBlockIds(activeBlockIds, lastRunEdges, edges).has(blockId)
}

/**
 * Selects whether a block belongs to the current live execution handoff.
 *
 * The selector returns a boolean so unrelated execution updates do not rerender
 * every block on the canvas.
 */
export function useIsBlockInActiveExecutionHandoff(blockId: string): boolean {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const edges = useWorkflowStore((state) => state.edges)

  return useExecutionStore((state) => {
    if (!activeWorkflowId) return false
    const execution = state.workflowExecutions.get(activeWorkflowId)
    if (!execution) return false

    return isBlockInActiveExecutionHandoff({
      blockId,
      isExecuting: execution.isExecuting,
      activeBlockIds: execution.activeBlockIds,
      lastRunEdges: execution.lastRunEdges,
      edges,
    })
  })
}
