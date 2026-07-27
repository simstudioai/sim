import { useCallback, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { runPreDeployChecks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-predeploy-checks'
import { useDeployWorkflow } from '@/hooks/queries/deployments'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { syncLocalDraftFromServer } from '@/stores/workflows/sync-local-draft'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { releaseDeployAction, tryAcquireDeployAction } from './deploy-action-lock'
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

  const handleDeployClick = useCallback(async () => {
    if (!workflowId) return { success: false, shouldOpenModal: false }

    if (isDeployed) {
      return { success: true, shouldOpenModal: true }
    }

    if (!tryAcquireDeployAction(workflowId)) {
      toast({ message: 'Deployment is already in progress.' })
      return { success: false, shouldOpenModal: false }
    }

    setIsFinalizingDeploy(true)
    try {
      const isReady = await deployReadiness.waitUntilReady()
      if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) {
        return { success: false, shouldOpenModal: false }
      }
      if (!isReady) {
        if (deployReadiness.status === 'error') {
          toast.error(deployReadiness.tooltip)
        } else {
          toast({ message: deployReadiness.tooltip })
        }
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
        toast.error(checkResult.error || 'Pre-deploy validation failed')
        return { success: false, shouldOpenModal: false }
      }

      try {
        await mutateAsync({ workflowId })
      } catch (error) {
        if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) {
          return { success: false, shouldOpenModal: false }
        }
        const errorMessage = toError(error).message || 'Failed to deploy workflow'
        toast.error(errorMessage)
        return { success: false, shouldOpenModal: false }
      }

      try {
        const syncedActiveWorkflow = await syncLocalDraftFromServer(workflowId)
        if (!syncedActiveWorkflow) {
          if (useWorkflowRegistry.getState().activeWorkflowId === workflowId) {
            logger.warn('Workflow deployed, but local draft sync was deferred', { workflowId })
            toast({
              message:
                'Deployment succeeded, but local sync is still catching up. Refresh if the status looks stale.',
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
        toast({
          message:
            'Deployment succeeded, but local sync failed. Refresh if the status looks stale.',
        })
      }

      return { success: true, shouldOpenModal: true }
    } finally {
      releaseDeployAction(workflowId)
      setIsFinalizingDeploy(false)
    }
  }, [workflowId, isDeployed, deployReadiness, mutateAsync])

  return {
    isDeploying: isDeploying || isFinalizingDeploy,
    handleDeployClick,
  }
}
