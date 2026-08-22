'use client'

import { useState } from 'react'
import { Chip, Tooltip, toast } from '@sim/emcn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { DeployModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal'
import {
  resolveDeployButtonStatus,
  useChangeDetection,
  useChangeDetectionCanary,
  useDeployment,
  useDeployReadiness,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useDeployedWorkflowState, useDeploymentInfo } from '@/hooks/queries/deployments'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface DeployProps {
  activeWorkflowId: string | null
  userPermissions: WorkspaceUserPermissions
  disabled?: boolean
}

export function Deploy({ activeWorkflowId, userPermissions, disabled = false }: DeployProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isRegistryLoading = hydrationPhase === 'idle' || hydrationPhase === 'state-loading'
  const { hasBlocks } = useCurrentWorkflow()

  const { data: deploymentInfo } = useDeploymentInfo(activeWorkflowId, {
    enabled: !isRegistryLoading,
  })
  const isDeployed = deploymentInfo?.isDeployed ?? false

  const isDeployedStateEnabled = Boolean(activeWorkflowId) && isDeployed && !isRegistryLoading
  const {
    data: deployedStateData,
    isLoading: isLoadingDeployedState,
    isFetching: isFetchingDeployedState,
  } = useDeployedWorkflowState(activeWorkflowId, { enabled: isDeployedStateEnabled })
  const deployedState = isDeployedStateEnabled ? (deployedStateData ?? null) : null
  const deployReadiness = useDeployReadiness(activeWorkflowId)

  /*
   * `isLoading` (no snapshot yet), NOT `isFetching`. A background refetch — which
   * `refetchOnWindowFocus` fires on every focus — still has the cached snapshot
   * to compare against, so treating it as loading blanked the answer and pushed
   * an already-correct "Update" back through "Live" and out again.
   */
  const { changeDetected, changedFields, isChangeDetectionSettling } = useChangeDetection({
    workflowId: activeWorkflowId,
    deployedState,
    isLoadingDeployedState,
  })
  const isDeploymentSettling = isChangeDetectionSettling || deployReadiness.isSyncing

  const serverNeedsRedeployment = isDeployedStateEnabled
    ? deploymentInfo?.needsRedeployment
    : undefined

  const buttonStatus = resolveDeployButtonStatus({
    workflowId: activeWorkflowId,
    isDeployed,
    isAwaitingFirstDeployedState: isLoadingDeployedState,
    clientChangeDetected: changeDetected,
    hasDeployedState: deployedState !== null,
    serverNeedsRedeployment,
  })
  const changeDetectedForModal = buttonStatus === 'changed'

  useChangeDetectionCanary({
    workflowId: activeWorkflowId,
    clientChangeDetected: changeDetected,
    clientChangedFields: changedFields,
    serverNeedsRedeployment,
    isSettling: isDeploymentSettling || deployedState === null,
    isSettled: deployReadiness.status === 'ready',
  })

  const { isDeploying, handleDeployClick } = useDeployment({
    workflowId: activeWorkflowId,
    isDeployed,
    deployReadiness,
  })

  const isEmpty = !hasBlocks()
  const canDeploy = userPermissions.canAdmin
  const isDisabled =
    disabled ||
    isDeploying ||
    !canDeploy ||
    isEmpty ||
    (!isDeployed && deployReadiness.isBlocked && !deployReadiness.isSyncing)

  const onDeployClick = async () => {
    if (isRegistryLoading || isDisabled || !activeWorkflowId) return

    if (isDeploymentSettling) {
      setIsModalOpen(true)
      return
    }

    const result = await handleDeployClick()
    if (result.shouldOpenModal) {
      setIsModalOpen(true)
    }
  }

  useRegisterGlobalCommands(() => [
    {
      id: 'deploy-workflow',
      handler: () => {
        /* The palette can't render a disabled state for this action yet, so a
           gated invocation reports the same reason the button's tooltip shows. */
        if (isRegistryLoading || isDisabled) {
          toast({ message: isRegistryLoading ? 'Workflow is still loading' : getTooltipText() })
          return
        }
        void onDeployClick()
      },
    },
  ])

  const getTooltipText = () => {
    if (isEmpty) {
      return 'Cannot deploy an empty workflow'
    }
    if (!canDeploy) {
      return 'Admin permissions required'
    }
    if (disabled) {
      return 'Workflow is locked'
    }
    if (isDeploying) {
      return 'Deploying...'
    }
    if (isChangeDetectionSettling) {
      return 'Syncing deployment state...'
    }
    if (deployReadiness.isBlocked && !isDeployed) {
      return deployReadiness.tooltip
    }
    if (buttonStatus === 'changed') {
      return 'Update deployment'
    }
    if (buttonStatus === 'live') {
      return 'Active deployment'
    }
    return 'Deploy workflow'
  }

  const getButtonLabel = () => {
    switch (buttonStatus) {
      case 'changed':
        return 'Update'
      case 'live':
        return 'Live'
      /*
       * Only reachable before we know the workflow is deployed, so "Deploy" is
       * the answer rather than a guess we would have to take back.
       */
      default:
        return 'Deploy'
    }
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Chip
              variant='border'
              onClick={onDeployClick}
              disabled={isRegistryLoading || isDisabled}
            >
              {getButtonLabel()}
            </Chip>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>{getTooltipText()}</Tooltip.Content>
      </Tooltip.Root>

      <DeployModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        workflowId={activeWorkflowId}
        isDeployed={isDeployed}
        needsRedeployment={changeDetectedForModal}
        deployedState={deployedState}
        isLoadingDeployedState={isLoadingDeployedState || isFetchingDeployedState}
        deployReadiness={deployReadiness}
        isDeploymentSettling={isDeploymentSettling}
      />
    </>
  )
}
