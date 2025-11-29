import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useCreateWorkflow, useWorkflows } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useWorkflowOperations')

interface UseWorkflowOperationsProps {
  workspaceId: string
  isWorkspaceValid: (workspaceId: string) => Promise<boolean>
  onWorkspaceInvalid: () => void
}

/**
 * Custom hook to manage workflow operations including creating and loading workflows.
 * Handles workflow state management and navigation.
 *
 * @param props - Configuration object containing workspaceId and validation handlers
 * @returns Workflow operations state and handlers
 */
export function useWorkflowOperations({
  workspaceId,
  isWorkspaceValid,
  onWorkspaceInvalid,
}: UseWorkflowOperationsProps) {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()
  const workflowsQuery = useWorkflows(workspaceId)
  const createWorkflowMutation = useCreateWorkflow()
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)

  /**
   * Filter and sort workflows for the current workspace
   */
  const regularWorkflows = Object.values(workflows)
    .filter((workflow) => workflow.workspaceId === workspaceId)
    .sort((a, b) => {
      // Sort by creation date (newest first) for stable ordering
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

  /**
   * Create workflow handler - creates workflow and navigates to it
   * Now uses React Query mutation for better performance and caching
   */
  const handleCreateWorkflow = useCallback(async (): Promise<string | null> => {
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      return null
    }

    try {
      setIsCreatingWorkflow(true)

      // Clear workflow diff store when creating a new workflow
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      // Use React Query mutation for creation
      const result = await createWorkflowMutation.mutateAsync({
        workspaceId: workspaceId,
      })

      // Navigate to the newly created workflow
      if (result.id) {
        router.push(`/workspace/${workspaceId}/w/${result.id}`)
        return result.id
      }
      return null
    } catch (error) {
      logger.error('Error creating workflow:', error)
      return null
    } finally {
      setIsCreatingWorkflow(false)
    }
  }, [isCreatingWorkflow, createWorkflowMutation, workspaceId, router])

  return {
    // State
    workflows,
    regularWorkflows,
    workflowsLoading: workflowsQuery.isLoading,
    isCreatingWorkflow,

    // Operations
    handleCreateWorkflow,
  }
}
