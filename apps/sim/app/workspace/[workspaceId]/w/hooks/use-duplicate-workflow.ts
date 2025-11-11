import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDuplicateWorkflow')

interface UseDuplicateWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Function that returns the workflow ID(s) to duplicate
   * This function is called when duplication occurs to get fresh selection state
   */
  getWorkflowIds: () => string | string[]
  /**
   * Optional callback after successful duplication
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow duplication.
 *
 * Handles:
 * - Single or bulk workflow duplication
 * - Calling duplicate API for each workflow
 * - Loading state management
 * - Error handling and logging
 * - Clearing selection after duplication
 * - Navigation to duplicated workflow (single only)
 *
 * @param props - Hook configuration
 * @returns Duplicate workflow handlers and state
 */
export function useDuplicateWorkflow({
  workspaceId,
  getWorkflowIds,
  onSuccess,
}: UseDuplicateWorkflowProps) {
  const router = useRouter()
  const { duplicateWorkflow } = useWorkflowRegistry()
  const [isDuplicating, setIsDuplicating] = useState(false)

  /**
   * Duplicate the workflow(s)
   */
  const handleDuplicateWorkflow = useCallback(async () => {
    if (isDuplicating) {
      return
    }

    setIsDuplicating(true)
    try {
      // Get fresh workflow IDs at duplication time
      const workflowIdsOrId = getWorkflowIds()
      if (!workflowIdsOrId) {
        return
      }

      // Normalize to array for consistent handling
      const workflowIdsToDuplicate = Array.isArray(workflowIdsOrId)
        ? workflowIdsOrId
        : [workflowIdsOrId]

      const duplicatedIds: string[] = []

      // Duplicate each workflow sequentially
      for (const workflowId of workflowIdsToDuplicate) {
        const newWorkflowId = await duplicateWorkflow(workflowId)
        if (newWorkflowId) {
          duplicatedIds.push(newWorkflowId)
        }
      }

      // Clear selection after successful duplication
      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Workflow(s) duplicated successfully', {
        workflowIds: workflowIdsToDuplicate,
        duplicatedIds,
      })

      // Navigate to duplicated workflow if single duplication
      if (duplicatedIds.length === 1) {
        router.push(`/workspace/${workspaceId}/w/${duplicatedIds[0]}`)
      }

      onSuccess?.()
    } catch (error) {
      logger.error('Error duplicating workflow(s):', { error })
      throw error
    } finally {
      setIsDuplicating(false)
    }
  }, [getWorkflowIds, isDuplicating, duplicateWorkflow, workspaceId, router, onSuccess])

  return {
    isDuplicating,
    handleDuplicateWorkflow,
  }
}
