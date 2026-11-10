import type { WorkflowBlockProps } from '@/components/workflow-editor/components/workflow-block/types'
import type { CurrentWorkflow } from '@/components/workflow-editor/hooks/use-current-workflow'
import { useIsBlockActive } from '@/stores/execution'

/**
 * Return type for the useBlockState hook
 */
export interface UseBlockStateReturn {
  /** Whether the block is currently enabled */
  isEnabled: boolean
  /** Whether the block is currently active (executing) */
  isActive: boolean
  /** Whether the block is locked */
  isLocked: boolean
}

/**
 * Custom hook for managing block state and execution status
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

  // Determine if block is locked
  const isLocked = data.isPreview
    ? (data.blockState?.locked ?? false)
    : (currentBlock?.locked ?? false)

  // Execution state
  const isActiveBlock = useIsBlockActive(blockId)
  const isActive = data.isActive || isActiveBlock

  return {
    isEnabled,
    isActive,
    isLocked,
  }
}
