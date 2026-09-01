import type { BlockState } from '@sim/workflow-types/workflow'

/** Whether a block, or any container above it, is locked against edits. */
export function isBlockProtected(blockId: string, blocksById: Record<string, BlockState>): boolean {
  const block = blocksById[blockId]
  if (!block) return false
  if (block.locked) return true

  const visited = new Set<string>()
  let parentId = block.data?.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    if (blocksById[parentId]?.locked) return true
    parentId = blocksById[parentId]?.data?.parentId
  }
  return false
}

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
 * cascades to its unlocked descendants. Both the dedicated
 * `workflows.blocks.set_enabled` use case and the `setBlockEnabled` slice of a
 * `workflows.operations.apply` batch call it, so the two cannot drift into
 * disagreeing about what is protected.
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
  if (isBlockProtected(blockId, blocks)) {
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
      if (!isBlockProtected(descendantId, blocks)) {
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
