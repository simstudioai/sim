import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useDuplicateWorkspace')

interface UseDuplicateWorkspaceProps {
  /**
   * Function that returns the workspace ID to duplicate
   * This function is called when duplication occurs to get fresh state
   */
  getWorkspaceId: () => string | null
  /**
   * Optional callback after successful duplication
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workspace duplication.
 *
 * Handles:
 * - Workspace duplication
 * - Calling duplicate API
 * - Loading state management
 * - Error handling and logging
 * - Navigation to duplicated workspace
 *
 * @param props - Hook configuration
 * @returns Duplicate workspace handlers and state
 */
export function useDuplicateWorkspace({ getWorkspaceId, onSuccess }: UseDuplicateWorkspaceProps) {
  const router = useRouter()
  const [isDuplicating, setIsDuplicating] = useState(false)

  /**
   * Duplicate the workspace
   */
  const handleDuplicateWorkspace = useCallback(
    async (workspaceName: string) => {
      if (isDuplicating) {
        return
      }

      setIsDuplicating(true)
      try {
        // Get fresh workspace ID at duplication time
        const workspaceId = getWorkspaceId()
        if (!workspaceId) {
          return
        }

        const response = await fetch(`/api/workspaces/${workspaceId}/duplicate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${workspaceName} (Copy)`,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to duplicate workspace: ${response.statusText}`)
        }

        const duplicatedWorkspace = await response.json()

        logger.info('Workspace duplicated successfully', {
          sourceWorkspaceId: workspaceId,
          newWorkspaceId: duplicatedWorkspace.id,
          workflowsCount: duplicatedWorkspace.workflowsCount,
        })

        // Navigate to duplicated workspace
        router.push(`/workspace/${duplicatedWorkspace.id}/w`)

        onSuccess?.()

        return duplicatedWorkspace.id
      } catch (error) {
        logger.error('Error duplicating workspace:', { error })
        throw error
      } finally {
        setIsDuplicating(false)
      }
    },
    [getWorkspaceId, isDuplicating, router, onSuccess]
  )

  return {
    isDuplicating,
    handleDuplicateWorkspace,
  }
}
