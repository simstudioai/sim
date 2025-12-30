import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useCreateWorkflow, useWorkflows } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  generateCreativeWorkflowName,
  getNextWorkflowColor,
} from '@/stores/workflows/registry/utils'

const logger = createLogger('useWorkflowOperations')

interface UseWorkflowOperationsProps {
  workspaceId: string
}

export function useWorkflowOperations({ workspaceId }: UseWorkflowOperationsProps) {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()
  const workflowsQuery = useWorkflows(workspaceId)
  const createWorkflowMutation = useCreateWorkflow()

  /**
   * Filter and sort workflows for the current workspace
   */
  const regularWorkflows = Object.values(workflows)
    .filter((workflow) => workflow.workspaceId === workspaceId)
    .sort((a, b) => {
      // Sort by creation date (newest first) for stable ordering
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

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
    // State
    workflows,
    regularWorkflows,
    workflowsLoading: workflowsQuery.isLoading,
    isCreatingWorkflow: createWorkflowMutation.isPending,

    // Operations
    handleCreateWorkflow,
  }
}
