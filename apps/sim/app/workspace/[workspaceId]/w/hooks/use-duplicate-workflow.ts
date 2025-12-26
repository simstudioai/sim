import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useDuplicateWorkflowMutation } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getNextWorkflowColor } from '@/stores/workflows/registry/utils'

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
 * Hook for managing workflow duplication with optimistic updates.
 *
 * Handles:
 * - Single or bulk workflow duplication
 * - Optimistic UI updates (shows new workflow immediately)
 * - Automatic rollback on failure
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
  const { workflows } = useWorkflowRegistry()
  const duplicateMutation = useDuplicateWorkflowMutation()

  /**
   * Duplicate the workflow(s)
   */
  const handleDuplicateWorkflow = useCallback(async () => {
    if (duplicateMutation.isPending) {
      return
    }

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

    try {
      // Duplicate each workflow sequentially
      for (const sourceId of workflowIdsToDuplicate) {
        const sourceWorkflow = workflows[sourceId]
        if (!sourceWorkflow) {
          logger.warn(`Workflow ${sourceId} not found, skipping`)
          continue
        }

        const result = await duplicateMutation.mutateAsync({
          workspaceId,
          sourceId,
          name: `${sourceWorkflow.name} (Copy)`,
          description: sourceWorkflow.description,
          color: getNextWorkflowColor(),
          folderId: sourceWorkflow.folderId,
        })

        duplicatedIds.push(result.id)
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
    }
  }, [getWorkflowIds, duplicateMutation, workflows, workspaceId, router, onSuccess])

  return {
    isDuplicating: duplicateMutation.isPending,
    handleDuplicateWorkflow,
  }
}
