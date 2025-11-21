import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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

  /**
   * Handle initial deployment and open modal
   */
  const handleDeployClick = useCallback(async () => {
    if (!workflowId) return { success: false, shouldOpenModal: false }

    // If undeployed, deploy first then open modal
    if (!isDeployed) {
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
          setDeploymentStatus(
            workflowId,
            isDeployedStatus,
            deployedAtTime,
            responseData.apiKey || ''
          )
          await refetchDeployedState()
          return { success: true, shouldOpenModal: true }
        }
        return { success: false, shouldOpenModal: true }
      } catch (error) {
        logger.error('Error deploying workflow:', error)
        return { success: false, shouldOpenModal: true }
      } finally {
        setIsDeploying(false)
      }
    }

    // If already deployed, just signal to open modal
    return { success: true, shouldOpenModal: true }
  }, [workflowId, isDeployed, refetchDeployedState, setDeploymentStatus])

  return {
    isDeploying,
    handleDeployClick,
  }
}
