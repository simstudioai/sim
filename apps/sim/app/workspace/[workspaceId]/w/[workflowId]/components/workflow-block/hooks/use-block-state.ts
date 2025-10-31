import { useCallback } from 'react'
import type { DiffStatus } from '@/lib/workflows/diff/types'
import { hasDiffStatus } from '@/lib/workflows/diff/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import type { CurrentWorkflow } from '../../../hooks/use-current-workflow'
import type { WorkflowBlockProps } from '../types'

/**
 * Return type for the useBlockState hook
 */
export interface UseBlockStateReturn {
  /** Whether the block is currently enabled */
  isEnabled: boolean
  /** Whether the block is currently active (executing) */
  isActive: boolean
  /** The diff status of the block */
  diffStatus: DiffStatus
  /** Whether this is a deleted block in diff mode */
  isDeletedBlock: boolean
  /** Field-level diff information */
  fieldDiff: any
}

/**
 * Custom hook for managing block state, execution status, and diff information
 *
 * @param blockId - The ID of the block
 * @param currentWorkflow - The current workflow object
 * @param data - The block data props
 * @returns Block state and status information
 */
export function useBlockState(
  blockId: string,
  currentWorkflow: CurrentWorkflow,
  data: WorkflowBlockProps
): UseBlockStateReturn {
  const currentBlock = currentWorkflow.getBlockById(blockId)

  // Determine if block is enabled
  const isEnabled = data.isPreview
    ? (data.blockState?.enabled ?? true)
    : (currentBlock?.enabled ?? true)

  // Get diff status
  const diffStatus: DiffStatus =
    currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
      ? currentBlock.is_diff
      : undefined

  // Get diff-related data
  const { diffAnalysis, isShowingDiff, fieldDiff } = useWorkflowDiffStore(
    useCallback(
      (state) => ({
        diffAnalysis: state.diffAnalysis,
        isShowingDiff: state.isShowingDiff,
        fieldDiff: currentWorkflow.isDiffMode
          ? state.diffAnalysis?.field_diffs?.[blockId]
          : undefined,
      }),
      [blockId, currentWorkflow.isDiffMode]
    )
  )

  const isDeletedBlock = !isShowingDiff && diffAnalysis?.deleted_blocks?.includes(blockId)

  // Execution state
  const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(blockId))
  const isActive = data.isActive || isActiveBlock

  return {
    isEnabled,
    isActive,
    diffStatus,
    isDeletedBlock: isDeletedBlock ?? false,
    fieldDiff,
  }
}
