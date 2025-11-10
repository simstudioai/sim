'use client'

import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Rocket } from '@/components/emcn'
import { DeployModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useChangeDetection, useDeployedState, useDeployment } from './hooks'

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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { isLoading: isRegistryLoading } = useWorkflowRegistry()

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

  // Detect changes between current and deployed state
  const { changeDetected, setChangeDetected } = useChangeDetection({
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

  const canDeploy = userPermissions.canAdmin
  const isDisabled = isDeploying || !canDeploy
  const isPreviousVersionActive = isDeployed && changeDetected

  /**
   * Handle deploy button click
   */
  const onDeployClick = useCallback(async () => {
    if (!canDeploy || !activeWorkflowId) return

    const result = await handleDeployClick()
    if (result.shouldOpenModal) {
      setIsModalOpen(true)
    }
  }, [canDeploy, activeWorkflowId, handleDeployClick])

  const refetchWithErrorHandling = async () => {
    if (!activeWorkflowId) return

    try {
      await refetchDeployedState()
    } catch (error) {
      // Error already logged in hook
    }
  }

  return (
    <>
      <Button
        className='h-[32px] gap-[8px] px-[10px]'
        variant='active'
        onClick={onDeployClick}
        disabled={isDisabled}
      >
        {isDeploying ? (
          <Loader2 className='h-[13px] w-[13px] animate-spin' />
        ) : (
          <Rocket className='h-[13px] w-[13px]' />
        )}
        {changeDetected ? 'Update' : isDeployed ? 'Active' : 'Deploy'}
      </Button>

      <DeployModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        workflowId={activeWorkflowId}
        needsRedeployment={changeDetected}
        setNeedsRedeployment={setChangeDetected}
        deployedState={deployedState!}
        isLoadingDeployedState={isLoadingDeployedState}
        refetchDeployedState={refetchWithErrorHandling}
      />
    </>
  )
}
