import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
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
   * Create workflow handler - creates workflow and navigates to it.
   * Uses React Query mutation's isPending state for immediate loading feedback.
   * Generates name and color upfront to enable optimistic UI updates.
   */
  const handleCreateWorkflow = useCallback(async (): Promise<string | null> => {
    if (createWorkflowMutation.isPending) {
      logger.info('Workflow creation already in progress, ignoring request')
      return null
    }

    try {
      // Clear workflow diff store when creating a new workflow
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      // Generate name and color upfront for optimistic updates
      const name = generateCreativeWorkflowName()
      const color = getNextWorkflowColor()

      // Use React Query mutation for creation - isPending updates immediately
      const result = await createWorkflowMutation.mutateAsync({
        workspaceId,
        name,
        color,
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
