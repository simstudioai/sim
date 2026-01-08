import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
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

  const fetchDeployedState = useCallback(async () => {
    const registry = useWorkflowRegistry.getState()
    const currentWorkflowId = registry.activeWorkflowId
    const deploymentStatus = currentWorkflowId
      ? registry.getWorkflowDeploymentStatus(currentWorkflowId)
      : null
    const currentIsDeployed = deploymentStatus?.isDeployed ?? false

    if (!currentWorkflowId || !currentIsDeployed) {
      setDeployedState(null)
      return
    }

    const requestWorkflowId = currentWorkflowId

    try {
      setIsLoadingDeployedState(true)

      const response = await fetch(`/api/workflows/${requestWorkflowId}/deployed`)

      if (requestWorkflowId !== useWorkflowRegistry.getState().activeWorkflowId) {
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

      if (requestWorkflowId === useWorkflowRegistry.getState().activeWorkflowId) {
        setDeployedState(data.deployedState || null)
      } else {
        logger.debug('Workflow changed after deployed state response, ignoring result')
      }
    } catch (error) {
      logger.error('Error fetching deployed state:', { error })
      if (requestWorkflowId === useWorkflowRegistry.getState().activeWorkflowId) {
        setDeployedState(null)
      }
    } finally {
      if (requestWorkflowId === useWorkflowRegistry.getState().activeWorkflowId) {
        setIsLoadingDeployedState(false)
      }
    }
  }, [])

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
