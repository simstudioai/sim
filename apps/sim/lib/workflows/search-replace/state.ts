import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface GetWorkflowSearchBlocksOptions {
  blocks: Record<string, BlockState>
  subblockValues?: Record<string, Record<string, unknown>>
}

export function getWorkflowSearchBlocks({
  blocks,
  subblockValues,
}: GetWorkflowSearchBlocksOptions): Record<string, BlockState> {
  if (!subblockValues) return blocks
  return mergeSubblockStateWithValues(blocks, subblockValues)
}
