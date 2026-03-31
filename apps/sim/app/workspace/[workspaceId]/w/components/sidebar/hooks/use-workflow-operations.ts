import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { useCreateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'

const logger = createLogger('useWorkflowOperations')

interface UseWorkflowOperationsProps {
  workspaceId: string
}

export function useWorkflowOperations({ workspaceId }: UseWorkflowOperationsProps) {
  const router = useRouter()
  const { data: workflows = {}, isLoading: workflowsLoading } = useWorkflowMap(workspaceId)
  const createWorkflowMutation = useCreateWorkflow()

  const regularWorkflows = useMemo(
    () =>
      Object.values(workflows)
        .filter((workflow) => workflow.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [workflows, workspaceId]
  )

  const handleCreateWorkflow = useCallback(async (): Promise<string | null> => {
    try {
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      const name = generateCreativeWorkflowName()
      const color = getNextWorkflowColor()

      const result = await createWorkflowMutation.mutateAsync({
        workspaceId,
        name,
        color,
        id: crypto.randomUUID(),
      })

      if (result.id) {
        router.push(`/workspace/${workspaceId}/w/${result.id}`)
        return result.id
      }
      return null
    } catch (error) {
      logger.error('Error creating workflow:', error)
      return null
    }
  }, [createWorkflowMutation, workspaceId, router])

  return {
    workflows,
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow: createWorkflowMutation.isPending,

    handleCreateWorkflow,
  }
}
