import { useCallback, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { useDuplicateWorkflowMutation } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'

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
  const duplicateMutation = useDuplicateWorkflowMutation()

  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  /**
   * Store a ref to the mutation to access isPending without causing callback recreation.
   * The mutateAsync function from React Query is already stable.
   */
  const mutationRef = useRef(duplicateMutation)
  mutationRef.current = duplicateMutation

  /**
   * Duplicate the workflow(s)
   * @param workflowIds - The workflow ID(s) to duplicate
   */
  const handleDuplicateWorkflow = useCallback(
    async (workflowIds: string | string[]) => {
      if (!workflowIds || (Array.isArray(workflowIds) && workflowIds.length === 0)) {
        return
      }

      if (mutationRef.current.isPending) {
        return
      }

      const workflowIdsToDuplicate = Array.isArray(workflowIds) ? workflowIds : [workflowIds]

      const duplicatedIds: string[] = []

      try {
        const workflowMap = new Map(getWorkflows(workspaceIdRef.current).map((w) => [w.id, w]))

        for (const sourceId of workflowIdsToDuplicate) {
          const sourceWorkflow = workflowMap.get(sourceId)
          if (!sourceWorkflow) {
            logger.warn(`Workflow ${sourceId} not found, skipping`)
            continue
          }

          const result = await mutationRef.current.mutateAsync({
            workspaceId: workspaceIdRef.current,
            sourceId,
            name: `${sourceWorkflow.name} (Copy)`,
            description: sourceWorkflow.description,
            color: getNextWorkflowColor(),
            folderId: sourceWorkflow.folderId,
            newId: generateId(),
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
          router.push(`/workspace/${workspaceIdRef.current}/w/${duplicatedIds[0]}`)
        }

        onSuccessRef.current?.()
      } catch (error) {
        logger.error('Error duplicating workflow(s):', { error })
        throw error
      }
    },
    [router]
  )

  return {
    isDuplicating: duplicateMutation.isPending,
    handleDuplicateWorkflow,
  }
}
