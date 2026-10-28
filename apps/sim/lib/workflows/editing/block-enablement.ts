import { type BlockState, isWorkflowBlockProtected } from '@sim/workflow-types/workflow'

/** Whether any container above a block is disabled, which keeps the block from running. */
export function hasDisabledAncestor(
  blockId: string,
  blocksById: Record<string, BlockState>
): boolean {
  const visited = new Set<string>()
  let parentId = blocksById[blockId]?.data?.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = blocksById[parentId]
    if (!parent) return false
    if (parent.enabled === false) return true
    parentId = parent.data?.parentId
  }
  return false
}

/** Every block nested, at any depth, inside a container. */
export function findDescendants(
  containerId: string,
  blocksById: Record<string, BlockState>
): string[] {
  const descendants: string[] = []
  const stack = [containerId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const [blockId, block] of Object.entries(blocksById)) {
      if (block.data?.parentId === current) {
        descendants.push(blockId)
        stack.push(blockId)
      }
    }
  }
  return descendants
}

export type BlockEnablementRefusal =
  | { reason: 'not_found'; message: string }
  | { reason: 'locked'; message: string }
  | { reason: 'disabled_ancestor'; message: string }

export type BlockEnablementDecision =
  | { outcome: 'refused'; refusal: BlockEnablementRefusal }
  | { outcome: 'unchanged'; affectedBlockIds: string[] }
  | { outcome: 'changed'; blocks: Record<string, BlockState>; affectedBlockIds: string[] }

/**
 * Decides what enabling or disabling one block does to a graph.
 *
 * Pure, and the single source of truth for the three protection rules — a
 * locked block or locked container cannot be toggled, a block cannot be enabled
 * while a container above it is disabled, and toggling a loop or parallel
 * cascades to its unlocked descendants. The `setBlockEnabled` slice of a
 * `workflows.operations.apply` batch calls it.
 */
export function decideBlockEnablement(
  blocks: Record<string, BlockState>,
  blockId: string,
  enabled: boolean
): BlockEnablementDecision {
  const targetBlock = blocks[blockId]
  if (!targetBlock) {
    return {
      outcome: 'refused',
      refusal: { reason: 'not_found', message: `Block ${blockId} not found` },
    }
  }
  if (isWorkflowBlockProtected(blockId, blocks)) {
    return {
      outcome: 'refused',
      refusal: {
        reason: 'locked',
        message: `Block ${blockId} is locked or inside a locked container and cannot be updated`,
      },
    }
  }
  if (enabled && hasDisabledAncestor(blockId, blocks)) {
    return {
      outcome: 'refused',
      refusal: {
        reason: 'disabled_ancestor',
        message: `Cannot enable block ${blockId} while one of its parent containers is disabled. Enable the parent first.`,
      },
    }
  }

  const affectedBlockIds = new Set<string>([blockId])
  if (targetBlock.type === 'loop' || targetBlock.type === 'parallel') {
    for (const descendantId of findDescendants(blockId, blocks)) {
      if (!isWorkflowBlockProtected(descendantId, blocks)) {
        affectedBlockIds.add(descendantId)
      }
    }
  }

  if (targetBlock.enabled === enabled) {
    return { outcome: 'unchanged', affectedBlockIds: [blockId] }
  }

  const nextBlocks = { ...blocks }
  for (const affectedId of affectedBlockIds) {
    nextBlocks[affectedId] = { ...nextBlocks[affectedId], enabled }
  }
  return { outcome: 'changed', blocks: nextBlocks, affectedBlockIds: [...affectedBlockIds] }
}
