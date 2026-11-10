import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { WorkflowBlockProps } from '@/components/workflow-editor/components/workflow-block/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
 * @param isPreview - Whether the block is in preview mode
 * @param blockState - The block state in preview mode
 * @returns Block properties and display states
 */
export function useBlockProperties(
  blockId: string,
  isPreview: boolean,
  blockState: WorkflowBlockProps['blockState']
): UseBlockPropertiesReturn {
  // Get block properties from workflow store
  const {
    storeHorizontalHandles,
    storeBlockHeight,
    storeBlockLayout,
    storeBlockAdvancedMode,
    storeBlockTriggerMode,
  } = useWorkflowStore(
    useShallow(
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
  )

  const horizontalHandles = isPreview
    ? (blockState?.horizontalHandles ?? true)
    : storeHorizontalHandles

  const blockHeight = storeBlockHeight
  const blockWidth = storeBlockLayout?.measuredWidth ?? 0

  // Compute display states
  const displayAdvancedMode = isPreview
    ? (blockState?.advancedMode ?? false)
    : storeBlockAdvancedMode

  const displayTriggerMode = isPreview ? (blockState?.triggerMode ?? false) : storeBlockTriggerMode

  return {
    horizontalHandles,
    blockHeight,
    blockWidth,
    displayAdvancedMode,
    displayTriggerMode,
  }
}
