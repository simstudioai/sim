import {
  isHumanInTheLoopBlock,
  isMetadataOnlyBlockType,
  isSentinelBlockType,
} from '@/executor/constants'

interface RetryEligibilityInput {
  blockType: string | undefined
  category: string | undefined
  triggerMode: boolean | undefined
}

/**
 * Whether a block may carry a retry policy.
 *
 * The single gate, read by the editor to decide whether to offer the control and
 * by the executor to decide whether to honor one. Splitting it would let a block
 * keep retrying after an edit that hides the control — flipping a configured
 * block into trigger mode, for instance.
 *
 * A human-in-the-loop block signals a pause by throwing, so retrying would
 * re-arm the pause instead of resuming it, and sentinels carry loop and parallel
 * iteration bookkeeping that a replay would re-enter. Metadata-only blocks never
 * run a handler that can fail, and a trigger fires the workflow rather than
 * running inside it.
 */
export function isRetryEligibleBlock({
  blockType,
  category,
  triggerMode,
}: RetryEligibilityInput): boolean {
  if (!blockType) return false
  if (isHumanInTheLoopBlock(blockType)) return false
  if (triggerMode === true || category === 'triggers') return false
  return !isSentinelBlockType(blockType) && !isMetadataOnlyBlockType(blockType)
}
