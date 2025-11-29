import { useCallback, useMemo } from 'react'
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
  const normalBlocks = useWorkflowStore(useCallback((state) => state.blocks, []))
  const baselineBlocks = useWorkflowDiffStore(
    useCallback((state) => state.baselineWorkflow?.blocks || {}, [])
  )

  const blockProperties = useMemo(() => {
    if (!blockId) {
      return {
        advancedMode: false,
        triggerMode: false,
      }
    }

    const blocks = isSnapshotView ? baselineBlocks : normalBlocks
    const block = blocks?.[blockId]

    return {
      advancedMode: block?.advancedMode ?? false,
      triggerMode: block?.triggerMode ?? false,
    }
  }, [blockId, isSnapshotView, normalBlocks, baselineBlocks])

  return blockProperties
}
