import type { Edge } from 'reactflow'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface TargetedLayoutChangeSetOptions {
  before: Pick<WorkflowState, 'blocks' | 'edges'>
  after: Pick<WorkflowState, 'blocks' | 'edges'>
}

export interface TargetedLayoutImpact {
  layoutBlockIds: string[]
  shiftSourceBlockIds: string[]
}

/**
 * Computes the minimal structural change set that should be reopened for
 * targeted layout after a workflow edit.
 */
export function getTargetedLayoutImpact({
  before,
  after,
}: TargetedLayoutChangeSetOptions): TargetedLayoutImpact {
  const layoutBlockIds = new Set<string>()
  const afterBlockIds = new Set(Object.keys(after.blocks || {}))
  const beforeBlockIds = new Set(Object.keys(before.blocks || {}))

  for (const blockId of afterBlockIds) {
    if (!beforeBlockIds.has(blockId)) {
      const position = after.blocks[blockId]?.position
      if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        (position.x === 0 && position.y === 0)
      ) {
        layoutBlockIds.add(blockId)
      }
      continue
    }

    const previousParentId = before.blocks[blockId]?.data?.parentId ?? null
    const currentParentId = after.blocks[blockId]?.data?.parentId ?? null
    if (previousParentId === currentParentId) {
      continue
    }

    const position = after.blocks[blockId]?.position
    if (position?.x === 0 && position?.y === 0) {
      layoutBlockIds.add(blockId)
    }
  }

  for (const blockId of getBlocksWithInvalidPositions(after, beforeBlockIds)) {
    layoutBlockIds.add(blockId)
  }

  const addedEdges = getAddedLayoutScopedEdges(before.edges || [], after.edges || [], after.blocks)
  if (addedEdges.length === 0) {
    return {
      layoutBlockIds: Array.from(layoutBlockIds),
      shiftSourceBlockIds: [],
    }
  }

  const beforeIncomingCounts = countIncomingLayoutScopedEdges(before.edges || [], before.blocks)
  const afterIncomingCounts = countIncomingLayoutScopedEdges(after.edges || [], after.blocks)

  for (const edge of addedEdges) {
    const targetBlock = after.blocks[edge.target]
    if (!targetBlock) {
      continue
    }

    const beforeIncoming = beforeIncomingCounts.get(edge.target) ?? 0
    const afterIncoming = afterIncomingCounts.get(edge.target) ?? 0

    if (beforeIncoming === 0 && afterIncoming > 0) {
      layoutBlockIds.add(edge.target)
    }
  }

  const shiftSourceBlockIds = new Set<string>()

  for (const edge of addedEdges) {
    if (!after.blocks[edge.source] || !after.blocks[edge.target]) {
      continue
    }

    if (layoutBlockIds.has(edge.target)) {
      continue
    }

    shiftSourceBlockIds.add(edge.source)
  }

  return {
    layoutBlockIds: Array.from(layoutBlockIds),
    shiftSourceBlockIds: Array.from(shiftSourceBlockIds),
  }
}

export function getTargetedLayoutChangeSet(options: TargetedLayoutChangeSetOptions): string[] {
  return getTargetedLayoutImpact(options).layoutBlockIds
}

/**
 * Returns block IDs that cannot be treated as stable layout anchors.
 * Existing blocks are only considered invalid for missing or non-finite
 * coordinates; `(0,0)` is reserved as a layout sentinel only for newly added
 * blocks and parent-change handling above.
 */
function getBlocksWithInvalidPositions(
  after: Pick<WorkflowState, 'blocks'>,
  beforeBlockIds: Set<string>
): string[] {
  return Object.keys(after.blocks || {}).filter((blockId) => {
    const position = after.blocks[blockId]?.position
    return (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      (!beforeBlockIds.has(blockId) && position.x === 0 && position.y === 0)
    )
  })
}

/**
 * Returns added edges that participate in layout within a shared parent scope.
 */
function getAddedLayoutScopedEdges(
  beforeEdges: Edge[],
  afterEdges: Edge[],
  afterBlocks: WorkflowState['blocks']
): Edge[] {
  const beforeSignatures = new Set(beforeEdges.map((edge) => getEdgeSignature(edge)))
  const addedEdges: Edge[] = []

  for (const edge of afterEdges) {
    if (beforeSignatures.has(getEdgeSignature(edge))) {
      continue
    }

    if (isLayoutScopedEdge(edge, afterBlocks)) {
      addedEdges.push(edge)
    }
  }

  return addedEdges
}

/**
 * Counts incoming edges that participate in layout within each shared parent
 * scope for the provided workflow snapshot.
 */
function countIncomingLayoutScopedEdges(
  edges: Edge[],
  blocks: WorkflowState['blocks']
): Map<string, number> {
  const counts = new Map<string, number>()

  for (const edge of edges) {
    if (!isLayoutScopedEdge(edge, blocks)) {
      continue
    }

    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1)
  }

  return counts
}

/**
 * Layout groups are scoped by parent container, so only edges whose endpoints
 * share the same current parent can affect the group's block positions.
 */
function isLayoutScopedEdge(edge: Edge, afterBlocks: WorkflowState['blocks']): boolean {
  const sourceBlock = afterBlocks[edge.source]
  const targetBlock = afterBlocks[edge.target]
  if (!sourceBlock || !targetBlock) {
    return false
  }

  const sourceParentId = sourceBlock.data?.parentId ?? null
  const targetParentId = targetBlock.data?.parentId ?? null
  return sourceParentId === targetParentId
}

/**
 * Creates a stable signature for comparing workflow edges independent of edge
 * record IDs.
 */
function getEdgeSignature(edge: Edge): string {
  return JSON.stringify([
    edge.source,
    edge.sourceHandle || 'source',
    edge.target,
    edge.targetHandle || 'target',
  ])
}
