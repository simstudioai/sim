import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import {
  collectErrorSourceBlockIds,
  normalizeWorkflowEdgeHandles,
} from '@sim/workflow-types/workflow'
import { type BoundingBox, boxesOverlap } from '@/lib/workflows/autolayout'
import { type CanvasPort, getCanvasPorts } from '@/lib/workflows/blocks/canvas-ports'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import { normalizedStringify, normalizeEdge } from '@/lib/workflows/comparison/normalize'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

/** How a block on the target side relates to the base side. */
export type BlockDiffStatus = 'added' | 'removed' | 'modified'

/** How an edge on the merged canvas relates to the base side. */
export type EdgeDiffStatus = 'added' | 'removed'

/**
 * Everything the canvas needs to paint a comparison of two workflow states.
 *
 * `mergedState` is the target state plus every block, container and edge that
 * only the base side has, so removed things render as ghosts at the position
 * they used to occupy instead of vanishing. Status maps are keyed by the ids in
 * `mergedState`, and `changedFieldsByBlock` lists the sub-block ids the summary
 * reported as changed so a card can highlight its own rows.
 */
export interface WorkflowDiffOverlay {
  mergedState: WorkflowState
  blockStatus: Record<string, BlockDiffStatus>
  edgeStatus: Record<string, EdgeDiffStatus>
  changedFieldsByBlock: Record<string, string[]>
  removedPortsByBlock: Record<string, CanvasPort[]>
}

/**
 * One key per port-to-port connection, canonicalized the same way the summary
 * canonicalizes edges so an edge counted as unchanged there can never paint as
 * added or removed here.
 */
function edgeKey(edge: WorkflowState['edges'][number]): string {
  return normalizedStringify(normalizeEdge(edge))
}

function snapshotPorts(state: WorkflowState): Map<string, CanvasPort[]> {
  const errorSources = collectErrorSourceBlockIds(state.edges)
  return new Map(
    Object.entries(state.blocks).map(([id, block]) => [
      id,
      getCanvasPorts(block, errorSources.has(id)),
    ])
  )
}

/** Extra ghost ports must not change which port an implicit edge originally used. */
function resolveDisplayHandles(
  edge: WorkflowState['edges'][number],
  ports: ReadonlyMap<string, CanvasPort[]>
): WorkflowState['edges'][number] {
  return {
    ...edge,
    sourceHandle:
      edge.sourceHandle ??
      ports.get(edge.source)?.find((port) => port.type === 'source')?.handleId ??
      null,
    targetHandle:
      edge.targetHandle ??
      ports.get(edge.target)?.find((port) => port.type === 'target')?.handleId ??
      null,
  }
}

const GHOST_GAP = 32

/** How big a block is drawn; the canvas passes its own measurement so ghost boxes match it. */
export type MeasureBlock = (
  block: BlockState,
  blocks: Record<string, BlockState>,
  removedPortsByBlock?: Record<string, CanvasPort[]>
) => { width: number; height: number }

/**
 * Stored sizes clamped to the canvas minimums: the fallback when the caller
 * does not pass the canvas's own measurement.
 */
const measureStoredSize: MeasureBlock = (block) => {
  const data = block.data as { width?: number; height?: number } | undefined
  if (block.type === 'loop' || block.type === 'parallel') {
    return {
      width: data?.width
        ? Math.max(data.width, CONTAINER_DIMENSIONS.MIN_WIDTH)
        : CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: data?.height
        ? Math.max(data.height, CONTAINER_DIMENSIONS.MIN_HEIGHT)
        : CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
  }
  return {
    width: BLOCK_DIMENSIONS.FIXED_WIDTH,
    height: Math.max(block.height || 0, BLOCK_DIMENSIONS.MIN_HEIGHT),
  }
}

function boxOf(
  block: BlockState,
  measure: MeasureBlock,
  blocks: Record<string, BlockState>,
  removedPortsByBlock: Record<string, CanvasPort[]>
): BoundingBox {
  return {
    x: block.position?.x ?? 0,
    y: block.position?.y ?? 0,
    ...measure(block, blocks, removedPortsByBlock),
  }
}

/**
 * A removed block keeps its old position, but a live block may have moved into
 * that spot since. Slide the ghost straight down until it clears every card in
 * `occupied` so it reads as "used to be around here" rather than sitting
 * underneath something, and record its final box so later ghosts avoid it too.
 * Occupied boxes belong to the same parent coordinate space as the ghost.
 */
function nudgeOutOfCollision(
  ghost: BlockState,
  occupied: BoundingBox[],
  measure: MeasureBlock,
  blocks: Record<string, BlockState>,
  removedPortsByBlock: Record<string, CanvasPort[]>
): BlockState {
  const box = boxOf(ghost, measure, blocks, removedPortsByBlock)
  let nudges = 0
  let hit = occupied.find((other) => boxesOverlap(box, other))
  while (hit) {
    box.y = hit.y + hit.height + GHOST_GAP
    nudges += 1
    hit = occupied.find((other) => boxesOverlap(box, other))
  }
  occupied.push(box)
  if (nudges === 0) return ghost
  return { ...ghost, position: { x: box.x, y: box.y } }
}

/**
 * Builds the canvas overlay for a base → target comparison.
 *
 * @param summary - The diff summary for the same pair (target compared against base)
 * @param baseState - The older or source side
 * @param targetState - The newer or destination side
 */
export function buildWorkflowDiffOverlay(
  summary: WorkflowDiffSummary,
  baseState: WorkflowState,
  targetState: WorkflowState,
  measure: MeasureBlock = measureStoredSize
): WorkflowDiffOverlay {
  const blockStatus: Record<string, BlockDiffStatus> = {}
  const changedFieldsByBlock: Record<string, string[]> = {}

  for (const block of summary.addedBlocks) blockStatus[block.id] = 'added'
  for (const block of summary.removedBlocks) blockStatus[block.id] = 'removed'
  for (const block of summary.modifiedBlocks) {
    blockStatus[block.id] = 'modified'
    changedFieldsByBlock[block.id] = block.changes
      .filter((change) => change.scope === 'subblock')
      .map((change) => change.field)
  }
  /* A reconfigured container, and a surviving block whose parent changed, both read as modified. */
  for (const container of summary.containerChanges) {
    blockStatus[container.id] ??= 'modified'
  }
  const blocks: WorkflowState['blocks'] = {}
  for (const [id, block] of Object.entries(targetState.blocks)) {
    const before = baseState.blocks[id]
    if (!before) {
      blocks[id] = block
      continue
    }
    if ((before.data?.parentId ?? null) !== (block.data?.parentId ?? null)) {
      blockStatus[id] ??= 'modified'
    }
    blocks[id] = block
  }

  for (const removed of summary.removedBlocks) {
    if (baseState.blocks[removed.id]) blocks[removed.id] = baseState.blocks[removed.id]
  }
  const targetKeyed = normalizeWorkflowEdgeHandles(targetState.edges ?? []).map(
    (edge) => [edge, edgeKey(edge)] as const
  )
  const baseKeyed = normalizeWorkflowEdgeHandles(baseState.edges ?? []).map(
    (edge) => [edge, edgeKey(edge)] as const
  )
  const targetKeys = new Set(targetKeyed.map(([, key]) => key))
  const baseKeys = new Set(baseKeyed.map(([, key]) => key))
  const targetPorts = snapshotPorts(targetState)
  const basePorts = snapshotPorts(baseState)

  const edgeStatus: Record<string, EdgeDiffStatus> = {}
  const edges: WorkflowState['edges'] = []
  const seenIds = new Set<string>()
  for (const [edge, key] of targetKeyed) {
    edges.push(resolveDisplayHandles(edge, targetPorts))
    seenIds.add(edge.id)
    if (!baseKeys.has(key)) edgeStatus[edge.id] = 'added'
  }
  for (const [edge, key] of baseKeyed) {
    if (targetKeys.has(key)) continue
    /* A base edge can share an id with a rewired target edge; keep both drawable. */
    let id = edge.id
    for (let attempt = 1; seenIds.has(id); attempt += 1) {
      id = attempt === 1 ? `${edge.id}__removed` : `${edge.id}__removed${attempt}`
    }
    seenIds.add(id)
    edges.push({ ...resolveDisplayHandles(edge, basePorts), id })
    edgeStatus[id] = 'removed'
  }

  const removedPortsByBlock: Record<string, CanvasPort[]> = {}
  const removedHandles = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edgeStatus[edge.id] !== 'removed') continue
    for (const type of ['source', 'target'] as const) {
      const blockId = edge[type]
      const handleId = type === 'source' ? edge.sourceHandle : edge.targetHandle
      if (!targetState.blocks[blockId] || !handleId) continue
      const handles = removedHandles.get(blockId) ?? new Set<string>()
      handles.add(`${type}:${handleId}`)
      removedHandles.set(blockId, handles)
    }
  }
  for (const [id, handles] of removedHandles) {
    const currentHandles = new Set(
      targetPorts.get(id)?.map((port) => `${port.type}:${port.handleId}`)
    )
    const ports = basePorts
      .get(id)
      ?.filter(
        (port) =>
          handles.has(`${port.type}:${port.handleId}`) &&
          !currentHandles.has(`${port.type}:${port.handleId}`)
      )
    if (ports?.length) removedPortsByBlock[id] = ports
  }

  const depth = (block: BlockState) => {
    const visited = new Set<string>([block.id])
    let parentId = block.data?.parentId
    while (parentId && blocks[parentId] && !visited.has(parentId)) {
      visited.add(parentId)
      parentId = blocks[parentId].data?.parentId
    }
    return visited.size
  }
  const ghosts = summary.removedBlocks.map(({ id }) => blocks[id]).filter(Boolean)
  ghosts.sort((a, b) => depth(b) - depth(a))
  const placed = new Set(Object.keys(targetState.blocks))
  for (const ghost of ghosts) {
    const occupied = Object.values(blocks)
      .filter((block) => placed.has(block.id) && block.data?.parentId === ghost.data?.parentId)
      .map((block) => boxOf(block, measure, blocks, removedPortsByBlock))
    blocks[ghost.id] = nudgeOutOfCollision(ghost, occupied, measure, blocks, removedPortsByBlock)
    placed.add(ghost.id)
  }

  const loops = { ...(targetState.loops ?? {}) }
  for (const [id, loop] of Object.entries(baseState.loops ?? {})) {
    if (!loops[id] && blockStatus[id] === 'removed') loops[id] = loop
  }
  const parallels = { ...(targetState.parallels ?? {}) }
  for (const [id, parallel] of Object.entries(baseState.parallels ?? {})) {
    if (!parallels[id] && blockStatus[id] === 'removed') parallels[id] = parallel
  }

  return {
    mergedState: {
      ...targetState,
      blocks,
      edges,
      loops,
      parallels,
    },
    blockStatus,
    edgeStatus,
    changedFieldsByBlock,
    removedPortsByBlock,
  }
}
