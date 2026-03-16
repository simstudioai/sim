import { useCallback } from 'react'
import { runPreDeployChecks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-predeploy-checks'
import { useDeployWorkflow } from '@/hooks/queries/deployments'
import { useNotificationStore } from '@/stores/notifications'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface UseDeploymentProps {
  workflowId: string | null
  isDeployed: boolean
}

/**
 * Hook to manage the deploy button click in the editor header.
 * First deploy: runs pre-deploy checks, then deploys via mutation and opens modal.
 * Already deployed: opens modal directly (validation happens on Update in modal).
 */
export function useDeployment({ workflowId, isDeployed }: UseDeploymentProps) {
  const { mutateAsync, isPending: isDeploying } = useDeployWorkflow()
  const addNotification = useNotificationStore((state) => state.addNotification)

  const handleDeployClick = useCallback(async () => {
    if (!workflowId) return { success: false, shouldOpenModal: false }

    if (isDeployed) {
      return { success: true, shouldOpenModal: true }
    }

    const { blocks, edges, loops, parallels } = useWorkflowStore.getState()
    const liveBlocks = mergeSubblockState(blocks, workflowId)
    const checkResult = runPreDeployChecks({
      blocks: liveBlocks,
      edges,
      loops,
      parallels,
      workflowId,
    })
    if (!checkResult.passed) {
      addNotification({
        level: 'error',
        message: checkResult.error || 'Pre-deploy validation failed',
        workflowId,
      })
      return { success: false, shouldOpenModal: false }
    }

    try {
      await mutateAsync({ workflowId, deployChatEnabled: false })
      return { success: true, shouldOpenModal: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to deploy workflow'
      addNotification({
        level: 'error',
        message: errorMessage,
        workflowId,
      })
      return { success: false, shouldOpenModal: false }
    }
  }, [workflowId, isDeployed, addNotification, mutateAsync])

  return {
    isDeploying,
    handleDeployClick,
  }
}
