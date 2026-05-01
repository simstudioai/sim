import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { duplicateWorkspaceContract } from '@/lib/api/contracts'

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
        const duplicatedWorkspace = await requestJson(duplicateWorkspaceContract, {
          params: { id: workspaceId },
          body: { name: `${workspaceName} (Copy)` },
        })

        logger.info('Workspace duplicated successfully', {
          sourceWorkspaceId: workspaceId,
          newWorkspaceId: duplicatedWorkspace.id,
          workflowsCount: duplicatedWorkspace.workflowsCount,
        })

        router.push(`/workspace/${duplicatedWorkspace.id}/home`)

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
