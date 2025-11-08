import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
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
  const {
    workflows,
    isLoading: workflowsLoading,
    loadWorkflows,
    createWorkflow,
  } = useWorkflowRegistry()
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

      const workflowId = await createWorkflow({
        workspaceId: workspaceId || undefined,
      })

      // Navigate to the newly created workflow
      if (workflowId) {
        router.push(`/workspace/${workspaceId}/w/${workflowId}`)
        return workflowId
      }
      return null
    } catch (error) {
      logger.error('Error creating workflow:', error)
      return null
    } finally {
      setIsCreatingWorkflow(false)
    }
  }, [isCreatingWorkflow, createWorkflow, workspaceId, router])

  /**
   * Load workflows for the current workspace when workspaceId changes
   */
  useEffect(() => {
    if (workspaceId) {
      // Validate workspace exists before loading workflows
      isWorkspaceValid(workspaceId).then((valid) => {
        if (valid) {
          loadWorkflows(workspaceId)
        } else {
          logger.warn(`Workspace ${workspaceId} no longer exists, triggering workspace refresh`)
          onWorkspaceInvalid()
        }
      })
    }
  }, [workspaceId, loadWorkflows, isWorkspaceValid, onWorkspaceInvalid])

  return {
    // State
    workflows,
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow,

    // Operations
    handleCreateWorkflow,
    loadWorkflows,
  }
}
