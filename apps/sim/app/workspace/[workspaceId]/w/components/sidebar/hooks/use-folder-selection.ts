import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseFolderSelectionProps {
  /**
   * Flat array of all folder IDs in display order
   */
  folderIds: string[]
  /**
   * Map from folder ID to ALL descendant workflow IDs (recursively, not just direct children)
   */
  folderDescendantWorkflowIds: Record<string, string[]>
  /**
   * Map from folder ID to all its ancestor folder IDs
   */
  folderAncestorIds: Record<string, string[]>
  /**
   * Map from folder ID to all its descendant folder IDs
   */
  folderDescendantIds: Record<string, string[]>
}

/**
 * Hook for managing folder selection with support for single, range, and toggle selection.
 * Handles shift-click for range selection and cmd/ctrl-click for toggle selection.
 * Uses the last selected folder ID (tracked in store) as the anchor point for range selections.
 * Enforces three constraints:
 *  - Selecting a folder deselects any workflows in its entire subtree
 *  - Cmd+click on a folder deselects its ancestors and descendants (clicked folder wins)
 *  - Range selection deduplicates ancestor-descendant pairs (keeps the ancestor)
 *
 * @param props - Hook props
 * @returns Selection handlers
 */
export function useFolderSelection({
  folderIds,
  folderDescendantWorkflowIds,
  folderAncestorIds,
  folderDescendantIds,
}: UseFolderSelectionProps) {
  const {
    selectedFolders,
    lastSelectedFolderId,
    selectFolderOnly,
    selectFolderRange,
    toggleFolderSelection,
  } = useFolderStore()

  /**
   * Deselect any workflows whose folder (or any ancestor folder) is currently selected.
   */
  const deselectConflictingWorkflows = useCallback(() => {
    const { selectedWorkflows: workflows, selectedFolders: folders } = useFolderStore.getState()
    if (workflows.size === 0) return

    for (const folderId of folders) {
      const wfIds = folderDescendantWorkflowIds[folderId]
      if (!wfIds) continue
      for (const wfId of wfIds) {
        if (workflows.has(wfId)) {
          useFolderStore.getState().deselectWorkflow(wfId)
        }
      }
    }
  }, [folderDescendantWorkflowIds])

  /**
   * For Cmd+click: the clicked folder wins. Deselect any selected folders that are
   * ancestors or descendants of the clicked folder.
   */
  const deselectRelatedFolders = useCallback(
    (clickedFolderId: string) => {
      const { selectedFolders: folders } = useFolderStore.getState()
      if (!folders.has(clickedFolderId) || folders.size <= 1) return

      const ancestors = folderAncestorIds[clickedFolderId] || []
      const descendants = folderDescendantIds[clickedFolderId] || []

      for (const id of ancestors) {
        if (folders.has(id)) {
          useFolderStore.getState().deselectFolder(id)
        }
      }
      for (const id of descendants) {
        if (folders.has(id)) {
          useFolderStore.getState().deselectFolder(id)
        }
      }
    },
    [folderAncestorIds, folderDescendantIds]
  )

  /**
   * For range selection: if both a folder and a nested subfolder end up in the range,
   * keep the ancestor and deselect the descendant (ancestor already covers it).
   */
  const deduplicateSelectedFolders = useCallback(() => {
    const { selectedFolders: folders } = useFolderStore.getState()
    if (folders.size <= 1) return

    for (const folderId of folders) {
      const ancestors = folderAncestorIds[folderId] || []
      for (const ancestorId of ancestors) {
        if (folders.has(ancestorId)) {
          useFolderStore.getState().deselectFolder(folderId)
          break
        }
      }
    }
  }, [folderAncestorIds])

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
        deselectRelatedFolders(folderId)
        deselectConflictingWorkflows()
      } else if (shiftKey && lastSelectedFolderId && lastSelectedFolderId !== folderId) {
        selectFolderRange(folderIds, lastSelectedFolderId, folderId)
        deduplicateSelectedFolders()
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
      deselectRelatedFolders,
      deduplicateSelectedFolders,
      deselectConflictingWorkflows,
    ]
  )

  return {
    selectedFolders,
    handleFolderClick,
  }
}
