import { useCallback } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { generateFolderName } from '@/lib/workspaces/naming'
import { useCreateFolder } from '@/hooks/queries/folders'

const logger = createLogger('useFolderOperations')

interface UseFolderOperationsProps {
  workspaceId: string
}

/**
 * Custom hook to manage folder operations including creating folders.
 * Handles folder name generation and state management.
 * Uses React Query mutation's isPending state for immediate loading feedback.
 *
 * @param props - Configuration object containing workspaceId
 * @returns Folder operations state and handlers
 */
export function useFolderOperations({ workspaceId }: UseFolderOperationsProps) {
  const createFolderMutation = useCreateFolder()

  /**
   * Create folder handler - creates folder with auto-generated name.
   * Generates name upfront to enable optimistic UI updates.
   */
  const handleCreateFolder = useCallback(async (): Promise<string | null> => {
    if (createFolderMutation.isPending || !workspaceId) {
      logger.info('Folder creation already in progress or no workspaceId available')
      return null
    }

    try {
      // Generate folder name upfront for optimistic updates
      const folderName = await generateFolderName(workspaceId)
      const folder = await createFolderMutation.mutateAsync({ name: folderName, workspaceId })
      logger.info(`Created folder: ${folderName}`)
      return folder.id
    } catch (error) {
      logger.error('Failed to create folder:', { error })
      return null
    }
  }, [createFolderMutation, workspaceId])

  return {
    // State
    isCreatingFolder: createFolderMutation.isPending,

    // Operations
    handleCreateFolder,
  }
}
