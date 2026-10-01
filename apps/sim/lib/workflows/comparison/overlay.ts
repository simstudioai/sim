import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import { normalizeWorkflowEdgeHandles } from '@sim/workflow-types/workflow'
import { type BoundingBox, boxesOverlap } from '@/lib/workflows/autolayout'
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
}

/**
 * One key per port-to-port connection, canonicalized the same way the summary
 * canonicalizes edges so an edge counted as unchanged there can never paint as
 * added or removed here.
 */
function edgeKey(edge: WorkflowState['edges'][number]): string {
  return normalizedStringify(normalizeEdge(edge))
}

const GHOST_GAP = 32

/** Sub-block fields whose list items each own a source handle on the canvas card. */
const BRANCH_LIST_FIELDS = ['conditions', 'routes'] as const

/** How big a block is drawn; the canvas passes its own measurement so ghost boxes match it. */
export type MeasureBlock = (
  block: BlockState,
  blocks: Record<string, BlockState>
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
  blocks: Record<string, BlockState>
): BoundingBox {
  return { x: block.position?.x ?? 0, y: block.position?.y ?? 0, ...measure(block, blocks) }
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
  blocks: Record<string, BlockState>
): BlockState {
  const box = boxOf(ghost, measure, blocks)
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

function readBranchList(value: unknown): Array<Record<string, unknown>> | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  return parsed.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
  )
}

/**
 * A surviving condition or router block draws one source handle per branch it
 * still has, so a ghost edge for a branch that was deleted would have nowhere
 * to start and the canvas would drop it. Carry the base side's missing branches
 * onto the merged card, in the JSON string the field persists, so the handle
 * exists.
 */
function withRemovedBranches(baseBlock: BlockState, targetBlock: BlockState): BlockState {
  let merged = targetBlock
  for (const field of BRANCH_LIST_FIELDS) {
    const baseItems = readBranchList(baseBlock.subBlocks?.[field]?.value)
    const targetItems = readBranchList(targetBlock.subBlocks?.[field]?.value)
    if (!baseItems || !targetItems) continue
    const present = new Set(targetItems.map((item) => item.id))
    if (baseItems.every((item) => typeof item.id !== 'string' || present.has(item.id))) continue
    /* Slot each missing branch back where it sat, so the roles the card reads off position hold. */
    const items = [...targetItems]
    for (let index = baseItems.length - 1; index >= 0; index -= 1) {
      const item = baseItems[index]
      if (typeof item.id !== 'string' || present.has(item.id)) continue
      const successor = baseItems.slice(index + 1).find((later) => present.has(later.id))
      const at = successor ? items.findIndex((candidate) => candidate.id === successor.id) : -1
      items.splice(at === -1 ? items.length : at, 0, item)
      present.add(item.id)
    }
    merged = {
      ...merged,
      subBlocks: {
        ...merged.subBlocks,
        [field]: { ...merged.subBlocks[field], value: JSON.stringify(items) },
      },
    }
  }
  return merged
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
    changedFieldsByBlock[block.id] = block.changes.map((change) => change.field)
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
    blocks[id] = withRemovedBranches(before, block)
  }

  for (const removed of summary.removedBlocks) {
    if (baseState.blocks[removed.id]) blocks[removed.id] = baseState.blocks[removed.id]
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
      .map((block) => boxOf(block, measure, blocks))
    blocks[ghost.id] = nudgeOutOfCollision(ghost, occupied, measure, blocks)
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

  const targetKeyed = normalizeWorkflowEdgeHandles(targetState.edges ?? []).map(
    (edge) => [edge, edgeKey(edge)] as const
  )
  const baseKeyed = normalizeWorkflowEdgeHandles(baseState.edges ?? []).map(
    (edge) => [edge, edgeKey(edge)] as const
  )
  const targetKeys = new Set(targetKeyed.map(([, key]) => key))
  const baseKeys = new Set(baseKeyed.map(([, key]) => key))

  const edgeStatus: Record<string, EdgeDiffStatus> = {}
  const edges: WorkflowState['edges'] = []
  const seenIds = new Set<string>()
  for (const [edge, key] of targetKeyed) {
    edges.push(edge)
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
    edges.push({ ...edge, id })
    edgeStatus[id] = 'removed'
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
  }
}
