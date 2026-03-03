'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { DeployModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal'
import {
  useChangeDetection,
  useDeployedState,
  useDeployment,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface DeployProps {
  activeWorkflowId: string | null
  userPermissions: WorkspaceUserPermissions
  className?: string
}

/**
 * Deploy component that handles workflow deployment
 * Manages deployed state, change detection, and deployment operations
 */
export function Deploy({ activeWorkflowId, userPermissions, className }: DeployProps) {
  const t = useTranslations('deploy')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isRegistryLoading =
    hydrationPhase === 'idle' ||
    hydrationPhase === 'metadata-loading' ||
    hydrationPhase === 'state-loading'
  const { hasBlocks } = useCurrentWorkflow()

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(activeWorkflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  // Fetch and manage deployed state
  const { deployedState, isLoadingDeployedState, refetchDeployedState } = useDeployedState({
    workflowId: activeWorkflowId,
    isDeployed,
    isRegistryLoading,
  })

  const { changeDetected } = useChangeDetection({
    workflowId: activeWorkflowId,
    deployedState,
    isLoadingDeployedState,
  })

  // Handle deployment operations
  const { isDeploying, handleDeployClick } = useDeployment({
    workflowId: activeWorkflowId,
    isDeployed,
    refetchDeployedState,
  })

  const isEmpty = !hasBlocks()
  const canDeploy = userPermissions.canAdmin
  const isDisabled = isDeploying || !canDeploy || isEmpty

  const onDeployClick = async () => {
    if (!canDeploy || !activeWorkflowId) return

    const result = await handleDeployClick()
    if (result.shouldOpenModal) {
      setIsModalOpen(true)
    }
  }

  /**
   * Get tooltip text based on current state
   */
  const getTooltipText = () => {
    if (isEmpty) {
      return t('tooltips.empty_workflow')
    }
    if (!canDeploy) {
      return t('tooltips.admin_required')
    }
    if (isDeploying) {
      return t('tooltips.deploying')
    }
    if (changeDetected) {
      return t('tooltips.update_deployment')
    }
    if (isDeployed) {
      return t('tooltips.active_deployment')
    }
    return t('tooltips.deploy_workflow')
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span>
            <Button
              className='h-[30px] gap-[6px] px-[10px]'
              variant={
                isRegistryLoading ? 'active' : changeDetected || !isDeployed ? 'tertiary' : 'active'
              }
              onClick={onDeployClick}
              disabled={isRegistryLoading || isDisabled}
            >
              {isDeploying && <Loader2 className='h-[13px] w-[13px] animate-spin' />}
              {changeDetected
                ? t('buttons.update')
                : isDeployed
                  ? t('buttons.live')
                  : t('buttons.deploy')}
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
        deployedState={deployedState!}
        isLoadingDeployedState={isLoadingDeployedState}
        refetchDeployedState={refetchDeployedState}
      />
    </>
  )
}
