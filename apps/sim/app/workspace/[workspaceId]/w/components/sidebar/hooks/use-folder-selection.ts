import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseFolderSelectionProps {
  /**
   * Flat array of all folder IDs in display order
   */
  folderIds: string[]
  /**
   * Map from folder ID to the workflow IDs directly inside that folder
   */
  folderWorkflowIds: Record<string, string[]>
}

/**
 * Hook for managing folder selection with support for single, range, and toggle selection.
 * Handles shift-click for range selection and cmd/ctrl-click for toggle selection.
 * Uses the last selected folder ID (tracked in store) as the anchor point for range selections.
 * Enforces parent-child constraint: selecting a folder deselects workflows inside it.
 *
 * @param props - Hook props
 * @returns Selection handlers
 */
export function useFolderSelection({ folderIds, folderWorkflowIds }: UseFolderSelectionProps) {
  const {
    selectedFolders,
    lastSelectedFolderId,
    selectFolderOnly,
    selectFolderRange,
    toggleFolderSelection,
  } = useFolderStore()

  /**
   * After a folder selection change, deselect any workflows whose parent folder is selected
   * to prevent parent-child co-selection.
   */
  const deselectConflictingWorkflows = useCallback(() => {
    const { selectedWorkflows: workflows, selectedFolders: folders } = useFolderStore.getState()
    if (workflows.size === 0) return

    for (const folderId of folders) {
      const wfIdsInFolder = folderWorkflowIds[folderId]
      if (!wfIdsInFolder) continue
      for (const wfId of wfIdsInFolder) {
        if (workflows.has(wfId)) {
          useFolderStore.getState().deselectWorkflow(wfId)
        }
      }
    }
  }, [folderWorkflowIds])

  /**
   * Handle folder click with support for shift-click range selection and cmd/ctrl-click toggle
   *
   * @param folderId - ID of clicked folder
   * @param shiftKey - Whether shift key was pressed
   * @param metaKey - Whether cmd (Mac) or ctrl (Windows) key was pressed
   */
  const handleFolderClick = useCallback(
    (folderId: string, shiftKey: boolean, metaKey: boolean) => {
      if (metaKey) {
        toggleFolderSelection(folderId)
        deselectConflictingWorkflows()
      } else if (shiftKey && lastSelectedFolderId && lastSelectedFolderId !== folderId) {
        selectFolderRange(folderIds, lastSelectedFolderId, folderId)
        deselectConflictingWorkflows()
      } else if (shiftKey) {
        selectFolderOnly(folderId)
        deselectConflictingWorkflows()
      } else {
        selectFolderOnly(folderId)
        deselectConflictingWorkflows()
      }
    },
    [
      folderIds,
      lastSelectedFolderId,
      selectFolderOnly,
      selectFolderRange,
      toggleFolderSelection,
      deselectConflictingWorkflows,
    ]
  )

  return {
    selectedFolders,
    handleFolderClick,
  }
}
