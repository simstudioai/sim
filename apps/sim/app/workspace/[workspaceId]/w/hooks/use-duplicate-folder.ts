import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('useDuplicateFolder')

interface UseDuplicateFolderProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Function that returns the folder ID(s) to duplicate
   * This function is called when duplication occurs to get fresh selection state
   */
  getFolderIds: () => string | string[]
  /**
   * Optional callback after successful duplication
   */
  onSuccess?: () => void
}

/**
 * Hook for managing folder duplication.
 *
 * Handles:
 * - Single or bulk folder duplication
 * - Calling duplicate API for each folder
 * - Loading state management
 * - Error handling and logging
 * - Clearing selection after duplication
 *
 * @param props - Hook configuration
 * @returns Duplicate folder handlers and state
 */
export function useDuplicateFolder({
  workspaceId,
  getFolderIds,
  onSuccess,
}: UseDuplicateFolderProps) {
  const { duplicateFolder } = useFolderStore()
  const [isDuplicating, setIsDuplicating] = useState(false)

  /**
   * Duplicate the folder(s)
   */
  const handleDuplicateFolder = useCallback(async () => {
    if (isDuplicating) {
      return
    }

    setIsDuplicating(true)
    try {
      // Get fresh folder IDs at duplication time
      const folderIdsOrId = getFolderIds()
      if (!folderIdsOrId) {
        return
      }

      // Normalize to array for consistent handling
      const folderIdsToDuplicate = Array.isArray(folderIdsOrId) ? folderIdsOrId : [folderIdsOrId]

      const duplicatedIds: string[] = []

      // Duplicate each folder sequentially
      for (const folderId of folderIdsToDuplicate) {
        const newFolderId = await duplicateFolder(folderId)
        if (newFolderId) {
          duplicatedIds.push(newFolderId)
        }
      }

      // Clear selection after successful duplication
      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Folder(s) duplicated successfully', {
        folderIds: folderIdsToDuplicate,
        duplicatedIds,
      })

      onSuccess?.()
    } catch (error) {
      logger.error('Error duplicating folder(s):', { error })
      throw error
    } finally {
      setIsDuplicating(false)
    }
  }, [getFolderIds, isDuplicating, duplicateFolder, onSuccess])

  return {
    isDuplicating,
    handleDuplicateFolder,
  }
}
