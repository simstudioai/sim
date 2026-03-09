import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'

const logger = createLogger('useDuplicateWorkspace')

interface UseDuplicateWorkspaceProps {
  /**
   * The workspace ID to duplicate
   */
  workspaceId: string | null
  /**
   * Optional callback after successful duplication
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workspace duplication.
 *
 * @param props - Hook configuration
 * @returns Duplicate workspace handlers and state
 */
export function useDuplicateWorkspace({ workspaceId, onSuccess }: UseDuplicateWorkspaceProps) {
  const router = useRouter()
  const [isDuplicating, setIsDuplicating] = useState(false)

  /**
   * Duplicate the workspace
   */
  const handleDuplicateWorkspace = useCallback(
    async (workspaceName: string) => {
      if (isDuplicating || !workspaceId) {
        return
      }

      setIsDuplicating(true)
      try {
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
    [workspaceId, isDuplicating, router, onSuccess]
  )

  return {
    isDuplicating,
    handleDuplicateWorkspace,
  }
}
