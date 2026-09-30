import { remapConditionEdgeHandle } from '@/lib/workflows/condition-ids'
import {
  remapConditionIdsInSubBlocks,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Re-keys a workflow state's blocks (and the edges, container membership and
 * parent references that name them) through a block-id resolver, without any
 * of the copy path's value sanitizing. Used to line a source workflow up with
 * its fork counterpart so the two diff block for block.
 */
export function remapWorkflowStateBlockIds(
  state: WorkflowState,
  resolve: (blockId: string) => string
): WorkflowState {
  const idMap = new Map<string, string>()
  for (const id of Object.keys(state.blocks)) idMap.set(id, resolve(id))
  const mapId = (id: string) => idMap.get(id) ?? id

  const blocks: WorkflowState['blocks'] = {}
  for (const [id, block] of Object.entries(state.blocks)) {
    const parentId = block.data?.parentId
    /* Condition and route ids embed the block id; the copy rewrites them, so the diff must too. */
    // double-cast-allowed: SubBlockRecord is the persistence view of the same sub-block map
    const sourceSubBlocks = (block.subBlocks ?? {}) as unknown as SubBlockRecord
    const remapped = remapConditionIdsInSubBlocks(sourceSubBlocks, block.type, id, mapId(id))
    // double-cast-allowed: back from the persistence view to the canvas state's sub-block map
    const subBlocks = remapped as unknown as WorkflowState['blocks'][string]['subBlocks']
    blocks[mapId(id)] = {
      ...block,
      id: mapId(id),
      subBlocks,
      data:
        typeof parentId === 'string' ? { ...block.data, parentId: mapId(parentId) } : block.data,
    }
  }

  const edges = (state.edges ?? []).map((edge) => ({
    ...edge,
    source: mapId(edge.source),
    target: mapId(edge.target),
    sourceHandle: edge.sourceHandle
      ? remapConditionEdgeHandle(edge.sourceHandle, edge.source, mapId(edge.source))
      : edge.sourceHandle,
  }))

  const remapContainers = <T extends { id: string; nodes: string[] }>(
    containers: Record<string, T> | undefined
  ): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [id, container] of Object.entries(containers ?? {})) {
      out[mapId(id)] = { ...container, id: mapId(id), nodes: container.nodes.map(mapId) }
    }
    return out
  }

  return {
    ...state,
    blocks,
    edges,
    loops: remapContainers(state.loops),
    parallels: remapContainers(state.parallels),
  }
}
