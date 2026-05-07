import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { runPreDeployChecks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-predeploy-checks'
import { useDeployWorkflow } from '@/hooks/queries/deployments'
import { useNotificationStore } from '@/stores/notifications'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { releaseDeployAction, tryAcquireDeployAction } from './deploy-action-lock'
import { syncLocalDraftFromServer } from './sync-local-draft'
import type { DeployReadiness } from './use-deploy-readiness'

const logger = createLogger('UseDeployment')

interface UseDeploymentProps {
  workflowId: string | null
  isDeployed: boolean
  deployReadiness: DeployReadiness
}

/**
 * Hook to manage the deploy button click in the editor header.
 * First deploy: runs pre-deploy checks, then deploys via mutation and opens modal.
 * Already deployed: opens modal directly (validation happens on Update in modal).
 */
export function useDeployment({ workflowId, isDeployed, deployReadiness }: UseDeploymentProps) {
  const { mutateAsync, isPending: isDeploying } = useDeployWorkflow()
  const [isFinalizingDeploy, setIsFinalizingDeploy] = useState(false)
  const addNotification = useNotificationStore((state) => state.addNotification)

  const handleDeployClick = useCallback(async () => {
    if (!workflowId) return { success: false, shouldOpenModal: false }

    if (isDeployed) {
      return { success: true, shouldOpenModal: true }
    }

    if (!tryAcquireDeployAction(workflowId)) {
      addNotification({
        level: 'info',
        message: 'Deployment is already in progress.',
        workflowId,
      })
      return { success: false, shouldOpenModal: false }
    }

    setIsFinalizingDeploy(true)
    try {
      const isReady = await deployReadiness.waitUntilReady()
      if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) {
        return { success: false, shouldOpenModal: false }
      }
      if (!isReady) {
        addNotification({
          level: deployReadiness.status === 'error' ? 'error' : 'info',
          message: deployReadiness.tooltip,
          workflowId,
        })
        return { success: false, shouldOpenModal: false }
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
        await mutateAsync({ workflowId })
      } catch (error) {
        if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) {
          return { success: false, shouldOpenModal: false }
        }
        const errorMessage = toError(error).message || 'Failed to deploy workflow'
        addNotification({
          level: 'error',
          message: errorMessage,
          workflowId,
        })
        return { success: false, shouldOpenModal: false }
      }

      try {
        const syncedActiveWorkflow = await syncLocalDraftFromServer(workflowId)
        if (!syncedActiveWorkflow) {
          if (useWorkflowRegistry.getState().activeWorkflowId === workflowId) {
            logger.warn('Workflow deployed, but local draft sync was deferred', { workflowId })
            addNotification({
              level: 'info',
              message:
                'Deployment succeeded, but local sync is still catching up. Refresh if the status looks stale.',
              workflowId,
            })
          }
          return { success: true, shouldOpenModal: false }
        }
      } catch (error) {
        if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) {
          return { success: true, shouldOpenModal: false }
        }
        logger.warn('Workflow deployed, but local draft sync failed', {
          workflowId,
          error: toError(error).message,
        })
        addNotification({
          level: 'info',
          message:
            'Deployment succeeded, but local sync failed. Refresh if the status looks stale.',
          workflowId,
        })
      }

      return { success: true, shouldOpenModal: true }
    } finally {
      releaseDeployAction(workflowId)
      setIsFinalizingDeploy(false)
    }
  }, [workflowId, isDeployed, deployReadiness, addNotification, mutateAsync])

  return {
    isDeploying: isDeploying || isFinalizingDeploy,
    handleDeployClick,
  }
}
