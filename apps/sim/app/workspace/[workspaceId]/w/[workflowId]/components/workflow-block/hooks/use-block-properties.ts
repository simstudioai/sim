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
  /** Whether the block is in advanced mode for display */
  displayAdvancedMode: boolean
  /** Whether the block is in trigger mode for display */
  displayTriggerMode: boolean
}

/**
 * Custom hook for managing block properties (trigger mode, advanced mode, handles, dimensions)
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
): UseBlockPropertiesReturn {
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

  // Get advanced mode from appropriate source
  const blockAdvancedMode = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.advancedMode ?? false)
    : storeBlockAdvancedMode

  // Get trigger mode from appropriate source
  const blockTriggerMode = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.triggerMode ?? false)
    : storeBlockTriggerMode

  // Compute display states
  const displayAdvancedMode = isPreview ? (blockState?.advancedMode ?? false) : blockAdvancedMode

  const displayTriggerMode = isPreview ? (blockState?.triggerMode ?? false) : blockTriggerMode

  return {
    horizontalHandles,
    blockHeight,
    blockWidth,
    displayAdvancedMode,
    displayTriggerMode,
  }
}
