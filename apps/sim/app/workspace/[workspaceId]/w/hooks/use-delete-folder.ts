import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('useDeleteFolder')

interface UseDeleteFolderProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Function that returns the folder ID(s) to delete
   * This function is called when deletion occurs to get fresh selection state
   */
  getFolderIds: () => string | string[]
  /**
   * Optional callback after successful deletion
   */
  onSuccess?: () => void
}

/**
 * Hook for managing folder deletion.
 *
 * Handles:
 * - Single or bulk folder deletion
 * - Calling delete API for each folder
 * - Loading state management
 * - Error handling and logging
 * - Clearing selection after deletion
 *
 * @param props - Hook configuration
 * @returns Delete folder handlers and state
 */
export function useDeleteFolder({ workspaceId, getFolderIds, onSuccess }: UseDeleteFolderProps) {
  const { deleteFolder } = useFolderStore()
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Delete the folder(s)
   */
  const handleDeleteFolder = useCallback(async () => {
    if (isDeleting) {
      return
    }

    setIsDeleting(true)
    try {
      // Get fresh folder IDs at deletion time
      const folderIdsOrId = getFolderIds()
      if (!folderIdsOrId) {
        return
      }

      // Normalize to array for consistent handling
      const folderIdsToDelete = Array.isArray(folderIdsOrId) ? folderIdsOrId : [folderIdsOrId]

      // Delete each folder sequentially
      for (const folderId of folderIdsToDelete) {
        await deleteFolder(folderId, workspaceId)
      }

      // Clear selection after successful deletion
      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Folder(s) deleted successfully', { folderIds: folderIdsToDelete })
      onSuccess?.()
    } catch (error) {
      logger.error('Error deleting folder(s):', { error })
      throw error
    } finally {
      setIsDeleting(false)
    }
  }, [getFolderIds, isDeleting, deleteFolder, workspaceId, onSuccess])

  return {
    isDeleting,
    handleDeleteFolder,
  }
}
