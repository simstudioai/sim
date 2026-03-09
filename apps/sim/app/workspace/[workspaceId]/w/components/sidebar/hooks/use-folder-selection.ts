import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseFolderSelectionProps {
  /**
   * Flat array of all folder IDs in display order
   */
  folderIds: string[]
}

/**
 * Hook for managing folder selection with support for single, range, and toggle selection.
 * Handles shift-click for range selection and cmd/ctrl-click for toggle selection.
 * Uses the last selected folder ID (tracked in store) as the anchor point for range selections.
 *
 * @param props - Hook props
 * @returns Selection handlers
 */
export function useFolderSelection({ folderIds }: UseFolderSelectionProps) {
  const {
    selectedFolders,
    lastSelectedFolderId,
    selectFolderOnly,
    selectFolderRange,
    toggleFolderSelection,
  } = useFolderStore()

  /**
   * Handle folder click with support for shift-click range selection and cmd/ctrl-click toggle
   *
   * @param folderId - ID of clicked folder
   * @param shiftKey - Whether shift key was pressed
   * @param metaKey - Whether cmd (Mac) or ctrl (Windows) key was pressed
   */
  const handleFolderClick = useCallback(
    (folderId: string, shiftKey: boolean, metaKey: boolean) => {
      // Cmd/Ctrl+Click: Toggle individual selection
      if (metaKey) {
        toggleFolderSelection(folderId)
      }
      // Shift+Click: Range selection from last selected folder to clicked folder
      else if (shiftKey && lastSelectedFolderId && lastSelectedFolderId !== folderId) {
        selectFolderRange(folderIds, lastSelectedFolderId, folderId)
      }
      // Shift+Click without anchor: Select only this folder (establishes anchor)
      else if (shiftKey) {
        selectFolderOnly(folderId)
      }
      // Regular click: Select only this folder
      else {
        selectFolderOnly(folderId)
      }
    },
    [folderIds, lastSelectedFolderId, selectFolderOnly, selectFolderRange, toggleFolderSelection]
  )

  return {
    selectedFolders,
    handleFolderClick,
  }
}
