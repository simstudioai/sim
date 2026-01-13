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
export function useDuplicateWorkflow({ workspaceId, onSuccess }: UseDuplicateWorkflowProps) {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()
  const duplicateMutation = useDuplicateWorkflowMutation()

  /**
   * Duplicate the workflow(s)
   * @param workflowIds - The workflow ID(s) to duplicate
   */
  const handleDuplicateWorkflow = useCallback(
    async (workflowIds: string | string[]) => {
      if (!workflowIds || (Array.isArray(workflowIds) && workflowIds.length === 0)) {
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
    },
    [duplicateMutation, workflows, workspaceId, router, onSuccess]
  )

  return {
    isDuplicating: duplicateMutation.isPending,
    handleDuplicateWorkflow,
  }
}
