import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { useDuplicateWorkflowMutation } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDuplicateWorkflow')

interface UseDuplicateWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Workflow ID(s) to duplicate
   */
  workflowIds: string | string[]
  /**
   * Optional callback after successful duplication
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow duplication with optimistic updates.
 *
 * @param props - Hook configuration
 * @returns Duplicate workflow handlers and state
 */
export function useDuplicateWorkflow({
  workspaceId,
  workflowIds,
  onSuccess,
}: UseDuplicateWorkflowProps) {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()
  const duplicateMutation = useDuplicateWorkflowMutation()

  /**
   * Duplicate the workflow(s)
   */
  const handleDuplicateWorkflow = useCallback(async () => {
    if (!workflowIds) {
      return
    }

    if (duplicateMutation.isPending) {
      return
    }

    const workflowIdsToDuplicate = Array.isArray(workflowIds) ? workflowIds : [workflowIds]

    const duplicatedIds: string[] = []

    try {
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

      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Workflow(s) duplicated successfully', {
        workflowIds: workflowIdsToDuplicate,
        duplicatedIds,
      })

      if (duplicatedIds.length === 1) {
        router.push(`/workspace/${workspaceId}/w/${duplicatedIds[0]}`)
      }

      onSuccess?.()
    } catch (error) {
      logger.error('Error duplicating workflow(s):', { error })
      throw error
    }
  }, [workflowIds, duplicateMutation, workflows, workspaceId, router, onSuccess])

  return {
    isDuplicating: duplicateMutation.isPending,
    handleDuplicateWorkflow,
  }
}
