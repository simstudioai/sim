import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
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

  const handleCreateFolder = useCallback(async (): Promise<string | null> => {
    if (!workspaceId) {
      return null
    }

    try {
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
