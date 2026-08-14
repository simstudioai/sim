'use client'

import { type MouseEvent, useState } from 'react'
import { Chip } from '@sim/emcn'
import { DeployPopover } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal'
import {
  useChangeDetection,
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
  const [isDeployPopoverOpen, setIsDeployPopoverOpen] = useState(false)
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

  const { changeDetected, isChangeDetectionSettling } = useChangeDetection({
    workflowId: activeWorkflowId,
    deployedState,
    isLoadingDeployedState: isLoadingDeployedState || isFetchingDeployedState,
  })
  const isDeploymentSettling = isChangeDetectionSettling || deployReadiness.isSyncing

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

  const onDeployClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || !canDeploy || !activeWorkflowId) return

    if (isDeployed || isDeploymentSettling) {
      return
    }

    event.preventDefault()
    const result = await handleDeployClick()
    if (result.shouldOpenModal) {
      setIsDeployPopoverOpen(true)
    }
  }

  const getButtonLabel = () => {
    if (changeDetected) {
      return 'Update'
    }
    if (isDeployed) {
      return 'Live'
    }
    return 'Deploy'
  }

  return (
    <DeployPopover
      open={isDeployPopoverOpen}
      onOpenChange={setIsDeployPopoverOpen}
      workflowId={activeWorkflowId}
      isDeployed={isDeployed}
      needsRedeployment={changeDetected}
      deployedState={deployedState}
      isLoadingDeployedState={isLoadingDeployedState || isFetchingDeployedState}
      deployReadiness={deployReadiness}
      isDeploymentSettling={isDeploymentSettling}
      trigger={
        <Chip variant='border' onClick={onDeployClick} disabled={isRegistryLoading || isDisabled}>
          {getButtonLabel()}
        </Chip>
      }
    />
  )
}
