import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useNotificationStore } from '@/stores/notifications'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { runPreDeployChecks } from './use-predeploy-checks'

const logger = createLogger('useDeployment')

interface UseDeploymentProps {
  workflowId: string | null
  isDeployed: boolean
  refetchDeployedState: () => Promise<void>
}

/**
 * Hook to manage deployment operations (deploy, undeploy, redeploy)
 */
export function useDeployment({
  workflowId,
  isDeployed,
  refetchDeployedState,
}: UseDeploymentProps) {
  const [isDeploying, setIsDeploying] = useState(false)
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)
  const addNotification = useNotificationStore((state) => state.addNotification)
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)
  const parallels = useWorkflowStore((state) => state.parallels)

  /**
   * Handle deploy button click
   * First deploy: calls API to deploy, then opens modal on success
   * Redeploy: validates client-side, then opens modal if valid
   */
  const handleDeployClick = useCallback(async () => {
    if (!workflowId) return { success: false, shouldOpenModal: false }

    if (isDeployed) {
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
      return { success: true, shouldOpenModal: true }
    }

    setIsDeploying(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployChatEnabled: false,
        }),
      })

      if (response.ok) {
        const responseData = await response.json()
        const isDeployedStatus = responseData.isDeployed ?? false
        const deployedAtTime = responseData.deployedAt
          ? new Date(responseData.deployedAt)
          : undefined
        setDeploymentStatus(workflowId, isDeployedStatus, deployedAtTime, responseData.apiKey || '')
        await refetchDeployedState()
        return { success: true, shouldOpenModal: true }
      }

      const errorData = await response.json()
      const errorMessage = errorData.error || 'Failed to deploy workflow'
      addNotification({
        level: 'error',
        message: errorMessage,
        workflowId,
      })
      return { success: false, shouldOpenModal: false }
    } catch (error) {
      logger.error('Error deploying workflow:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to deploy workflow'
      addNotification({
        level: 'error',
        message: errorMessage,
        workflowId,
      })
      return { success: false, shouldOpenModal: false }
    } finally {
      setIsDeploying(false)
    }
  }, [
    workflowId,
    isDeployed,
    blocks,
    edges,
    loops,
    parallels,
    refetchDeployedState,
    setDeploymentStatus,
    addNotification,
  ])

  return {
    isDeploying,
    handleDeployClick,
  }
}
