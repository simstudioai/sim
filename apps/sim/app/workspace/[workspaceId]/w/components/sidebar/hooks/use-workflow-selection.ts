import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseWorkflowSelectionProps {
  /**
   * Flat array of all workflow IDs in display order
   */
  workflowIds: string[]
  /**
   * Active workflow ID (from URL) - used as anchor for range selection
   */
  activeWorkflowId: string | undefined
  /**
   * Map from workflow ID to all its ancestor folder IDs (direct parent first, then up)
   */
  workflowAncestorFolderIds: Record<string, string[]>
}

/**
 * Hook for managing workflow selection with support for single, range, and toggle selection.
 * Handles shift-click for range selection and regular click for single selection.
 * Uses the active workflow ID as the anchor point for range selections.
 * Enforces ancestor constraint: selecting a workflow deselects any ancestor folder.
 *
 * @param props - Hook props
 * @returns Selection handlers
 */
export function useWorkflowSelection({
  workflowIds,
  activeWorkflowId,
  workflowAncestorFolderIds,
}: UseWorkflowSelectionProps) {
  const { selectedWorkflows, selectOnly, selectRange, toggleWorkflowSelection } = useFolderStore()

  /**
   * After a workflow selection change, deselect any folder that is an ancestor of a selected
   * workflow to prevent ancestor-descendant co-selection.
   */
  const deselectConflictingFolders = useCallback(() => {
    const { selectedWorkflows: workflows, selectedFolders: folders } = useFolderStore.getState()
    if (folders.size === 0) return

    for (const wfId of workflows) {
      const ancestorIds = workflowAncestorFolderIds[wfId]
      if (!ancestorIds) continue
      for (const folderId of ancestorIds) {
        if (folders.has(folderId)) {
          useFolderStore.getState().deselectFolder(folderId)
        }
      }
    }
  }, [workflowAncestorFolderIds])

  /**
   * Handle workflow click with support for shift-click range selection and cmd/ctrl-click toggle.
   *
   * @param workflowId - ID of clicked workflow
   * @param shiftKey - Whether shift key was pressed
   * @param metaKey - Whether cmd (Mac) or ctrl (Windows) key was pressed
   */
  const handleWorkflowClick = useCallback(
    (workflowId: string, shiftKey: boolean, metaKey: boolean) => {
      if (metaKey) {
        toggleWorkflowSelection(workflowId)
        deselectConflictingFolders()
      } else if (shiftKey && activeWorkflowId && activeWorkflowId !== workflowId) {
        selectRange(workflowIds, activeWorkflowId, workflowId)
        deselectConflictingFolders()
      } else if (shiftKey) {
        toggleWorkflowSelection(workflowId)
        deselectConflictingFolders()
      } else {
        selectOnly(workflowId)
      }
    },
    [
      workflowIds,
      activeWorkflowId,
      selectOnly,
      selectRange,
      toggleWorkflowSelection,
      deselectConflictingFolders,
    ]
  )

  return {
    selectedWorkflows,
    handleWorkflowClick,
  }
}
