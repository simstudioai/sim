import { useCallback, useEffect, useState } from 'react'
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
  /** Local state for advanced mode in diff mode */
  diffAdvancedMode: boolean
  /** Local state for trigger mode in diff mode */
  diffTriggerMode: boolean
  /** Setter for diff advanced mode */
  setDiffAdvancedMode: React.Dispatch<React.SetStateAction<boolean>>
  /** Setter for diff trigger mode */
  setDiffTriggerMode: React.Dispatch<React.SetStateAction<boolean>>
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

  // Local UI state for diff mode controls
  const [diffAdvancedMode, setDiffAdvancedMode] = useState<boolean>(blockAdvancedMode)
  const [diffTriggerMode, setDiffTriggerMode] = useState<boolean>(blockTriggerMode)

  // Sync local diff state when entering diff mode or blockId changes
  useEffect(() => {
    if (isDiffMode) {
      setDiffAdvancedMode(blockAdvancedMode)
      setDiffTriggerMode(blockTriggerMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDiffMode, blockId])

  // Compute display states
  const displayAdvancedMode = isDiffMode
    ? diffAdvancedMode
    : isPreview
      ? (blockState?.advancedMode ?? false)
      : blockAdvancedMode

  const displayTriggerMode = isDiffMode
    ? diffTriggerMode
    : isPreview
      ? (blockState?.triggerMode ?? false)
      : blockTriggerMode

  return {
    horizontalHandles,
    blockHeight,
    blockWidth,
    displayAdvancedMode,
    displayTriggerMode,
    diffAdvancedMode,
    diffTriggerMode,
    setDiffAdvancedMode,
    setDiffTriggerMode,
  }
}
