import { useCallback, useMemo } from 'react'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Custom hook for managing block display properties in the editor panel.
 * Provides access to advanced mode and trigger mode states.
 *
 * @param blockId - The ID of the block being edited
 * @param isDiffMode - Whether we're currently viewing a diff
 * @returns Block display properties (advanced mode, trigger mode)
 */
export function useEditorBlockProperties(blockId: string | null, isDiffMode: boolean) {
  // Get blocks from appropriate source
  const normalBlocks = useWorkflowStore(useCallback((state) => state.blocks, []))
  const diffWorkflow = useWorkflowDiffStore(useCallback((state) => state.diffWorkflow, []))

  const blockProperties = useMemo(() => {
    if (!blockId) {
      return {
        advancedMode: false,
        triggerMode: false,
      }
    }

    // Get block from appropriate source based on mode
    const blocks = isDiffMode ? (diffWorkflow as any)?.blocks || {} : normalBlocks
    const block = blocks[blockId]

    return {
      advancedMode: block?.advancedMode ?? false,
      triggerMode: block?.triggerMode ?? false,
    }
  }, [blockId, isDiffMode, normalBlocks, diffWorkflow])

  return blockProperties
}
