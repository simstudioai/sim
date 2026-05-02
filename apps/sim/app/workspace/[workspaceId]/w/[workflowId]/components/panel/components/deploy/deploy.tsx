'use client'

import { useState } from 'react'
import { Button, Loader, Tooltip } from '@/components/emcn'
import { DeployModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal'
import {
  useChangeDetection,
  useDeployment,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useDeployedWorkflowState, useDeploymentInfo } from '@/hooks/queries/deployments'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface DeployProps {
  activeWorkflowId: string | null
  userPermissions: WorkspaceUserPermissions
  className?: string
  disabled?: boolean
}

export function Deploy({
  activeWorkflowId,
  userPermissions,
  className,
  disabled = false,
}: DeployProps) {
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

  const { changeDetected } = useChangeDetection({
    workflowId: activeWorkflowId,
    deployedState,
    isLoadingDeployedState: isLoadingDeployedState || isFetchingDeployedState,
  })

  const { isDeploying, handleDeployClick } = useDeployment({
    workflowId: activeWorkflowId,
    isDeployed,
  })

  const isEmpty = !hasBlocks()
  const canDeploy = userPermissions.canAdmin
  const isDisabled = disabled || isDeploying || !canDeploy || isEmpty

  const onDeployClick = async () => {
    if (disabled || !canDeploy || !activeWorkflowId) return

    const result = await handleDeployClick()
    if (result.shouldOpenModal) {
      setIsModalOpen(true)
    }
  }

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
    if (changeDetected) {
      return 'Update deployment'
    }
    if (isDeployed) {
      return 'Active deployment'
    }
    return 'Deploy workflow'
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span>
            <Button
              className='h-[30px] gap-1.5 px-2.5'
              variant={
                isRegistryLoading ? 'active' : changeDetected || !isDeployed ? 'tertiary' : 'active'
              }
              onClick={onDeployClick}
              disabled={isRegistryLoading || isDisabled}
            >
              {isDeploying && <Loader className='h-[13px] w-[13px]' animate />}
              {changeDetected ? 'Update' : isDeployed ? 'Live' : 'Deploy'}
            </Button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>{getTooltipText()}</Tooltip.Content>
      </Tooltip.Root>

      <DeployModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        workflowId={activeWorkflowId}
        isDeployed={isDeployed}
        needsRedeployment={changeDetected}
        deployedState={deployedState}
        isLoadingDeployedState={isLoadingDeployedState}
      />
    </>
  )
}
