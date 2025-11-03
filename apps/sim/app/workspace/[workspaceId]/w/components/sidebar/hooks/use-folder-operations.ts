import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { generateFolderName } from '@/lib/naming'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('useFolderOperations')

interface UseFolderOperationsProps {
  workspaceId: string
}

/**
 * Custom hook to manage folder operations including creating folders.
 * Handles folder name generation and state management.
 *
 * @param props - Configuration object containing workspaceId
 * @returns Folder operations state and handlers
 */
export function useFolderOperations({ workspaceId }: UseFolderOperationsProps) {
  const { createFolder } = useFolderStore()
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  /**
   * Create folder handler - creates folder with auto-generated name
   */
  const handleCreateFolder = useCallback(async (): Promise<string | null> => {
    if (isCreatingFolder || !workspaceId) {
      logger.info('Folder creation already in progress or no workspaceId available')
      return null
    }

    try {
      setIsCreatingFolder(true)
      const folderName = await generateFolderName(workspaceId)
      const folder = await createFolder({ name: folderName, workspaceId })
      logger.info(`Created folder: ${folderName}`)
      return folder.id
    } catch (error) {
      logger.error('Failed to create folder:', { error })
      return null
    } finally {
      setIsCreatingFolder(false)
    }
  }, [createFolder, workspaceId, isCreatingFolder])

  return {
    // State
    isCreatingFolder,

    // Operations
    handleCreateFolder,
  }
}
