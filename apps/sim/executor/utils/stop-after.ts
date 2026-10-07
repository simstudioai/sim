import { BlockType, isHumanInTheLoopBlock } from '@/executor/constants'
import type { SerializedBlock } from '@/serializer/types'

/**
 * Whether `stopAfterBlockId` targets a block that pauses the run — a
 * human-in-the-loop or wait block.
 *
 * Such a target cannot be honored. The run pauses at that block, and the resume
 * path prunes the paused block's outgoing edges, so the stop target would be lost
 * and execution would continue past it. Callers reject it upfront instead of
 * starting a run whose stop target resume cannot keep.
 */
export function isPausingStopTarget(
  blocks: readonly SerializedBlock[],
  stopAfterBlockId: string
): boolean {
  const blockType = blocks.find((block) => block.id === stopAfterBlockId)?.metadata?.id
  return isHumanInTheLoopBlock(blockType) || blockType === BlockType.WAIT
}
