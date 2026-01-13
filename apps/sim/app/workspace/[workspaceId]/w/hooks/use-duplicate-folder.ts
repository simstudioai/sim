import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useDuplicateFolderMutation } from '@/hooks/queries/folders'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('useDuplicateFolder')

interface UseDuplicateFolderProps {
  workspaceId: string
  /**
   * The folder ID(s) to duplicate
   */
  folderIds: string | string[]
  onSuccess?: () => void
}

/**
 * Hook for managing folder duplication.
 *
 * @param props - Hook configuration
 * @returns Duplicate folder handlers and state
 */
export function useDuplicateFolder({ workspaceId, folderIds, onSuccess }: UseDuplicateFolderProps) {
  const duplicateFolderMutation = useDuplicateFolderMutation()
  const [isDuplicating, setIsDuplicating] = useState(false)

  const generateDuplicateName = useCallback((baseName: string, siblingNames: Set<string>) => {
    const trimmedName = (baseName || 'Untitled Folder').trim()
    let candidate = `${trimmedName} Copy`
    let counter = 2

    while (siblingNames.has(candidate)) {
      candidate = `${trimmedName} Copy ${counter}`
      counter += 1
    }

    return candidate
  }, [])

  /**
   * Duplicate the folder(s)
   */
  const handleDuplicateFolder = useCallback(async () => {
    if (isDuplicating) {
      return
    }

    if (!folderIds) {
      return
    }

    setIsDuplicating(true)
    try {
      const folderIdsToDuplicate = Array.isArray(folderIds) ? folderIds : [folderIds]

      const duplicatedIds: string[] = []
      const folderStore = useFolderStore.getState()

      for (const folderId of folderIdsToDuplicate) {
        const folder = folderStore.getFolderById(folderId)

        if (!folder) {
          logger.warn('Attempted to duplicate folder that no longer exists', { folderId })
          continue
        }

        const siblingNames = new Set(
          folderStore.getChildFolders(folder.parentId).map((sibling) => sibling.name)
        )
        siblingNames.add(folder.name)

        const duplicateName = generateDuplicateName(folder.name, siblingNames)

        const result = await duplicateFolderMutation.mutateAsync({
          id: folderId,
          workspaceId,
          name: duplicateName,
          parentId: folder.parentId,
          color: folder.color,
        })
        const newFolderId = result?.id
        if (newFolderId) {
          duplicatedIds.push(newFolderId)
        }
      }

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
  }, [
    folderIds,
    generateDuplicateName,
    isDuplicating,
    duplicateFolderMutation,
    workspaceId,
    onSuccess,
  ])

  return {
    isDuplicating,
    handleDuplicateFolder,
  }
}
