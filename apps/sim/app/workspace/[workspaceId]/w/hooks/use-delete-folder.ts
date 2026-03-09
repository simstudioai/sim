import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useDeleteFolderMutation } from '@/hooks/queries/folders'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('useDeleteFolder')

interface UseDeleteFolderProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * The folder ID(s) to delete
   */
  folderIds: string | string[]
  /**
   * Optional callback after successful deletion
   */
  onSuccess?: () => void
}

/**
 * Hook for managing folder deletion.
 *
 * @param props - Hook configuration
 * @returns Delete folder handlers and state
 */
export function useDeleteFolder({ workspaceId, folderIds, onSuccess }: UseDeleteFolderProps) {
  const deleteFolderMutation = useDeleteFolderMutation()
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Delete the folder(s)
   */
  const handleDeleteFolder = useCallback(async () => {
    if (isDeleting) {
      return
    }

    if (!folderIds) {
      return
    }

    setIsDeleting(true)
    try {
      const folderIdsToDelete = Array.isArray(folderIds) ? folderIds : [folderIds]

      for (const folderId of folderIdsToDelete) {
        await deleteFolderMutation.mutateAsync({ id: folderId, workspaceId })
      }

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
  }, [folderIds, isDeleting, deleteFolderMutation, workspaceId, onSuccess])

  return {
    isDeleting,
    handleDeleteFolder,
  }
}
