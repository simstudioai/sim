import { useCallback, useEffect, useState } from 'react'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowBlockProps } from '../types'

/**
 * Custom hook for managing block properties (wide, advanced mode, trigger mode, handles)
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
    storeIsWide,
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
          storeIsWide: block?.isWide ?? false,
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

  // Determine if wide
  const isWide = isDiffMode ? (currentWorkflowBlocks[blockId]?.isWide ?? false) : storeIsWide

  // Determine block dimensions
  const blockHeight = isDiffMode ? (currentWorkflowBlocks[blockId]?.height ?? 0) : storeBlockHeight

  const blockWidth = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.layout?.measuredWidth ?? 0)
    : (storeBlockLayout?.measuredWidth ?? 0)

  // Determine advanced mode
  const blockAdvancedMode = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.advancedMode ?? false)
    : storeBlockAdvancedMode

  // Determine trigger mode
  const blockTriggerMode = isDiffMode
    ? (currentWorkflowBlocks[blockId]?.triggerMode ?? false)
    : storeBlockTriggerMode

  // Local UI state for diff mode controls
  const [diffIsWide, setDiffIsWide] = useState<boolean>(isWide)
  const [diffAdvancedMode, setDiffAdvancedMode] = useState<boolean>(blockAdvancedMode)
  const [diffTriggerMode, setDiffTriggerMode] = useState<boolean>(blockTriggerMode)

  // Sync diff mode state with current values
  useEffect(() => {
    if (isDiffMode) {
      setDiffIsWide(isWide)
      setDiffAdvancedMode(blockAdvancedMode)
      setDiffTriggerMode(blockTriggerMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDiffMode, blockId])

  // Display states
  const displayIsWide = isDiffMode ? diffIsWide : isWide
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
    isWide,
    blockHeight,
    blockWidth,
    blockAdvancedMode,
    blockTriggerMode,
    displayIsWide,
    displayAdvancedMode,
    displayTriggerMode,
    diffIsWide,
    setDiffIsWide,
    diffAdvancedMode,
    setDiffAdvancedMode,
    diffTriggerMode,
    setDiffTriggerMode,
  }
}
