import { useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('useDeployedState')

interface UseDeployedStateProps {
  workflowId: string | null
  isDeployed: boolean
  isRegistryLoading: boolean
}

/**
 * Hook to fetch and manage deployed workflow state
 * Includes race condition protection for workflow changes
 */
export function useDeployedState({
  workflowId,
  isDeployed,
  isRegistryLoading,
}: UseDeployedStateProps) {
  const [deployedState, setDeployedState] = useState<WorkflowState | null>(null)
  const [isLoadingDeployedState, setIsLoadingDeployedState] = useState<boolean>(false)

  const setNeedsRedeploymentFlag = useWorkflowRegistry(
    (state) => state.setWorkflowNeedsRedeployment
  )

  /**
   * Fetches the deployed state of the workflow from the server
   * This is the single source of truth for deployed workflow state
   */
  const fetchDeployedState = async () => {
    if (!workflowId || !isDeployed) {
      setDeployedState(null)
      return
    }

    // Store the workflow ID at the start of the request to prevent race conditions
    const requestWorkflowId = workflowId

    // Helper to get current active workflow ID for race condition checks
    const getCurrentActiveWorkflowId = () => useWorkflowRegistry.getState().activeWorkflowId

    try {
      setIsLoadingDeployedState(true)

      const response = await fetch(`/api/workflows/${requestWorkflowId}/deployed`)

      // Check if the workflow ID changed during the request (user navigated away)
      if (requestWorkflowId !== getCurrentActiveWorkflowId()) {
        logger.debug('Workflow changed during deployed state fetch, ignoring response')
        return
      }

      if (!response.ok) {
        if (response.status === 404) {
          setDeployedState(null)
          return
        }
        throw new Error(`Failed to fetch deployed state: ${response.statusText}`)
      }

      const data = await response.json()

      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setDeployedState(data.deployedState || null)
      } else {
        logger.debug('Workflow changed after deployed state response, ignoring result')
      }
    } catch (error) {
      logger.error('Error fetching deployed state:', { error })
      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setDeployedState(null)
      }
    } finally {
      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setIsLoadingDeployedState(false)
      }
    }
  }

  useEffect(() => {
    if (!workflowId) {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
      return
    }

    if (isRegistryLoading) {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
      return
    }

    if (isDeployed) {
      setNeedsRedeploymentFlag(workflowId, false)
      fetchDeployedState()
    } else {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, isDeployed, isRegistryLoading, setNeedsRedeploymentFlag])

  return {
    deployedState,
    isLoadingDeployedState,
    refetchDeployedState: fetchDeployedState,
  }
}
