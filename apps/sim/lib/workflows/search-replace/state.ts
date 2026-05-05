import { mergeSubblockState } from '@/stores/workflows/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface GetWorkflowSearchBlocksOptions {
  blocks: Record<string, BlockState>
  workflowId?: string
  isSnapshotView?: boolean
}

export function getWorkflowSearchBlocks({
  blocks,
  workflowId,
  isSnapshotView,
}: GetWorkflowSearchBlocksOptions): Record<string, BlockState> {
  if (isSnapshotView || !workflowId) return blocks
  return mergeSubblockState(blocks, workflowId)
}
