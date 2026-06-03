import { UNDO_REDO_OPERATIONS } from '@sim/realtime-protocol/constants'
import type { BatchUpdateSubblocksOperation, Operation } from '@/stores/undo-redo/types'

export interface UndoRedoRevealTarget {
  blockId: string
}

/**
 * Returns the block an applied undo/redo operation should bring into view, or null
 * when the operation's effect is already visible on the canvas. Only field edits
 * (subblock and subflow config values) can change something off-screen inside a
 * closed editor panel, so only they reveal a target; structural operations
 * (block/edge add, remove, move, reparent) are visible on the canvas already.
 */
export function getRevealTarget(operation: Operation): UndoRedoRevealTarget | null {
  if (operation.type !== UNDO_REDO_OPERATIONS.BATCH_UPDATE_SUBBLOCKS) return null
  const { updates, subflowUpdates } = (operation as BatchUpdateSubblocksOperation).data
  const blockId = updates[0]?.blockId ?? subflowUpdates?.[0]?.blockId
  return blockId ? { blockId } : null
}
