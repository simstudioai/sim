import type { Edge } from 'reactflow'
import { useExecutionStore } from '@/stores/execution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

type HandoffEdges = ReadonlyArray<Pick<Edge, 'id' | 'source' | 'target'>>

/**
 * Only edge *membership* matters here — an edge id being present means it was
 * taken. The status value is deliberately `unknown` so this stays a pure
 * function over the minimum it reads, testable without the execution store.
 */
type TakenEdgeIds = ReadonlyMap<string, unknown>

interface ActiveExecutionHandoffOptions {
  blockId: string
  isExecuting: boolean
  activeBlockIds: ReadonlySet<string>
  lastRunEdges: TakenEdgeIds
  edges: HandoffEdges
}

interface ActiveExecutionHandoffCache {
  lastRunEdges: TakenEdgeIds
  edges: HandoffEdges
  highlightedBlockIds: ReadonlySet<string>
}

/**
 * Memoised per execution snapshot.
 *
 * Every card on the canvas asks this same question on every execution update,
 * so the walk runs once per snapshot rather than once per card. Keyed *weakly*
 * on `activeBlockIds` so an entry dies with the snapshot that produced it —
 * a module-level slot would pin the last workflow's edges, active-block set and
 * run-status map for the lifetime of the tab.
 */
const activeExecutionHandoffCache = new WeakMap<ReadonlySet<string>, ActiveExecutionHandoffCache>()

/** Resolves the active handoff once for every immutable execution snapshot. */
function getActiveExecutionHandoffBlockIds(
  activeBlockIds: ReadonlySet<string>,
  lastRunEdges: TakenEdgeIds,
  edges: HandoffEdges
): ReadonlySet<string> {
  const cached = activeExecutionHandoffCache.get(activeBlockIds)
  if (cached && cached.lastRunEdges === lastRunEdges && cached.edges === edges) {
    return cached.highlightedBlockIds
  }

  const highlightedBlockIds = new Set(activeBlockIds)
  for (const edge of edges) {
    if (lastRunEdges.has(edge.id) && activeBlockIds.has(edge.target)) {
      highlightedBlockIds.add(edge.source)
    }
  }

  activeExecutionHandoffCache.set(activeBlockIds, {
    lastRunEdges,
    edges,
    highlightedBlockIds,
  })

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

  return useExecutionStore((state) => {
    if (!activeWorkflowId) return false
    const execution = state.workflowExecutions.get(activeWorkflowId)
    if (!execution) return false

    /*
     * Edges are read, not subscribed to. `state.edges` is a fresh array after
     * ~25 store actions that change no edge at all — block-dimension
     * measurement among them — so subscribing here would re-render every card
     * on the canvas each time one block is measured. The topology is static for
     * the duration of a run, and this selector re-runs on every execution
     * update, so an edge added mid-run is picked up on the next active-block
     * change. Sibling subscriptions in `workflow-block.tsx` derive a primitive
     * for the same reason.
     */
    return isBlockInActiveExecutionHandoff({
      blockId,
      isExecuting: execution.isExecuting,
      activeBlockIds: execution.activeBlockIds,
      lastRunEdges: execution.lastRunEdges,
      edges: useWorkflowStore.getState().edges,
    })
  })
}
