import { useCallback } from 'react'
import { shallow } from 'zustand/shallow'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Custom hook for managing block display properties in the editor panel.
 * Provides access to advanced mode and trigger mode states.
 *
 * @param blockId - The ID of the block being edited
 * @param isSnapshotView - Whether we're currently viewing the baseline snapshot
 * @returns Block display properties (advanced mode, trigger mode)
 */
export function useEditorBlockProperties(blockId: string | null, isSnapshotView: boolean) {
  const normalBlockProps = useWorkflowStore(
    useCallback(
      (state) => {
        if (!blockId) return { advancedMode: false, triggerMode: false }
        const block = state.blocks?.[blockId]
        return {
          advancedMode: block?.advancedMode ?? false,
          triggerMode: block?.triggerMode ?? false,
        }
      },
      [blockId]
    ),
    shallow
  )

  const baselineBlockProps = useWorkflowDiffStore(
    useCallback(
      (state) => {
        if (!blockId) return { advancedMode: false, triggerMode: false }
        const block = state.baselineWorkflow?.blocks?.[blockId]
        return {
          advancedMode: block?.advancedMode ?? false,
          triggerMode: block?.triggerMode ?? false,
        }
      },
      [blockId]
    ),
    shallow
  )

  // Use the appropriate props based on view mode
  return isSnapshotView ? baselineBlockProps : normalBlockProps
}
