import { useCallback } from 'react'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowBlockProps } from '../types'

/**
 * Return type for the useBlockProperties hook
 */
export interface UseBlockPropertiesReturn {
  /** Whether the block uses horizontal handles for connections */
  horizontalHandles: boolean
  /** The measured height of the block in pixels */
  blockHeight: number
  /** The measured width of the block in pixels */
  blockWidth: number
  /** Whether the block is in trigger mode */
  displayTriggerMode: boolean
}

/**
 * Custom hook for managing block properties (trigger mode, handles, dimensions)
 *
 * @param blockId - The ID of the block
 * @param isDiffMode - Whether the workflow is in diff mode
 * @param isPreview - Whether the block is in preview mode
 * @param blockState - The block state in preview mode
 * @param currentWorkflowBlocks - Current workflow blocks for diff mode
 * @returns Block properties and display states
 */
export function useBlockProperties(
  blockId: string,
  isDiffMode: boolean,
  isPreview: boolean,
  blockState: WorkflowBlockProps['blockState'],
  currentWorkflowBlocks: Record<string, any>
) {
  // Get block properties from workflow store
  const {
    storeHorizontalHandles,
    storeBlockHeight,
    storeBlockLayout,
    storeBlockAdvancedMode,
    storeBlockTriggerMode,
  } = useWorkflowStore(
    useCallback(
      (state) => {
        const block = state.blocks[blockId]
        return {
          storeHorizontalHandles: block?.horizontalHandles ?? true,
          storeBlockHeight: block?.height ?? 0,
          storeBlockLayout: block?.layout,
          storeBlockAdvancedMode: block?.advancedMode ?? false,
          storeBlockTriggerMode: block?.triggerMode ?? false,
        }
      },
      [blockId]
    )
  )

  // Determine horizontal handles
  const horizontalHandles = isPreview
    ? (blockState?.horizontalHandles ?? true)
    : isDiffMode
      ? (currentWorkflowBlocks[blockId]?.horizontalHandles ?? true)
      : storeHorizontalHandles

  // Determine block dimensions
  const blockHeight = isDiffMode ? (currentWorkflowBlocks[blockId]?.height ?? 0) : storeBlockHeight

  const blockWidth = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.layout?.measuredWidth ?? 0)
    : (storeBlockLayout?.measuredWidth ?? 0)

  // Determine trigger mode
  const blockTriggerMode = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.triggerMode ?? false)
    : storeBlockTriggerMode

  // Display states
  const displayTriggerMode = isDiffMode
    ? blockTriggerMode
    : isPreview
      ? (blockState?.triggerMode ?? false)
      : blockTriggerMode

  return {
    horizontalHandles,
    blockHeight,
    blockWidth,
    displayTriggerMode,
  }
}
