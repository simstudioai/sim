import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface GetWorkflowSearchBlocksOptions {
  blocks: Record<string, BlockState>
  isSnapshotView?: boolean
  subblockValues?: Record<string, Record<string, unknown>>
}

export function getWorkflowSearchBlocks({
  blocks,
  isSnapshotView,
  subblockValues,
}: GetWorkflowSearchBlocksOptions): Record<string, BlockState> {
  if (isSnapshotView || !subblockValues) return blocks
  return mergeSubblockStateWithValues(blocks, subblockValues)
}
