import type { WorkflowState } from '@/stores/workflows/workflow/types'

type DagBlockState = {
  id?: string
  type?: string
  name?: string
}

type DagEdgeState = {
  source?: string | null
  target?: string | null
}

/**
 * Compute the workflow's downstream adjacency: each non-note block name mapped
 * to the sorted, de-duplicated names of the blocks it connects to.
 *
 * Because conditions, routers, and subflow containers all encode their fan-out
 * as real edges (`if`/`else`, `route-N`, `loop-start-source`/`loop-end-source`,
 * `error`), a plain edge-based adjacency captures them correctly. Every non-note
 * block appears as a key; sink blocks map to `[]`. Edges to/from note blocks or
 * missing blocks are ignored, as are self-edges (in the name view).
 */
export function computeWorkflowDag(
  workflowState: Pick<WorkflowState, 'blocks' | 'edges'>
): Record<string, string[]> {
  const blocks = (workflowState.blocks || {}) as Record<string, DagBlockState>
  const edges = Array.isArray(workflowState.edges)
    ? (workflowState.edges as DagEdgeState[])
    : ([] as DagEdgeState[])

  const nameById = new Map<string, string>()
  for (const [blockId, block] of Object.entries(blocks)) {
    if (block?.type === 'note') continue
    nameById.set(blockId, block?.name || blockId)
  }

  const downstream = new Map<string, Set<string>>()
  for (const name of nameById.values()) {
    if (!downstream.has(name)) downstream.set(name, new Set<string>())
  }

  for (const edge of edges) {
    const sourceName = nameById.get(edge?.source || '')
    const targetName = nameById.get(edge?.target || '')
    if (!sourceName || !targetName) continue
    if (sourceName === targetName) continue
    downstream.get(sourceName)?.add(targetName)
  }

  const result: Record<string, string[]> = {}
  for (const [name, targets] of downstream) {
    result[name] = Array.from(targets).sort()
  }
  return result
}
