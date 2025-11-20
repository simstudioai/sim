'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Rocket } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DeployModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface DeploymentControlsProps {
  activeWorkflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
  refetchDeployedState: () => Promise<void>
  userPermissions: WorkspaceUserPermissions
}

export function DeploymentControls({
  activeWorkflowId,
  needsRedeployment,
  setNeedsRedeployment,
  deployedState,
  isLoadingDeployedState,
  refetchDeployedState,
  userPermissions,
}: DeploymentControlsProps) {
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(activeWorkflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  const workflowNeedsRedeployment = needsRedeployment
  const isPreviousVersionActive = isDeployed && workflowNeedsRedeployment

  const [isDeploying, setIsDeploying] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const lastWorkflowIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (activeWorkflowId !== lastWorkflowIdRef.current) {
      lastWorkflowIdRef.current = activeWorkflowId
    }
  }, [activeWorkflowId])

  const refetchWithErrorHandling = async () => {
    if (!activeWorkflowId) return

    try {
      await refetchDeployedState()
    } catch (error) {}
  }

  const canDeploy = userPermissions.canAdmin
  const isDisabled = isDeploying || !canDeploy

  const handleDeployClick = useCallback(async () => {
    if (!canDeploy || !activeWorkflowId) return

    // If undeployed, deploy first then open modal
    if (!isDeployed) {
      setIsDeploying(true)
      try {
        const response = await fetch(`/api/workflows/${activeWorkflowId}/deploy`, {
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
          const setDeploymentStatus = useWorkflowRegistry.getState().setDeploymentStatus
          const isDeployedStatus = responseData.isDeployed ?? false
          const deployedAtTime = responseData.deployedAt
            ? new Date(responseData.deployedAt)
            : undefined
          setDeploymentStatus(
            activeWorkflowId,
            isDeployedStatus,
            deployedAtTime,
            responseData.apiKey || ''
          )
          await refetchWithErrorHandling()
          // Open modal after successful deployment
          setIsModalOpen(true)
        }
      } catch (error) {
        // On error, still open modal to show error
        setIsModalOpen(true)
      } finally {
        setIsDeploying(false)
      }
      return
    }

    // If already deployed, just open modal
    setIsModalOpen(true)
  }, [canDeploy, isDeployed, activeWorkflowId, refetchWithErrorHandling])

  const getTooltipText = () => {
    if (!canDeploy) {
      return 'Admin permissions required to deploy workflows'
    }
    if (isDeploying) {
      return 'Deploying...'
    }
    if (isDeployed && workflowNeedsRedeployment) {
      return 'Workflow changes detected'
    }
    if (isDeployed) {
      return 'Deployment Settings'
    }
    return 'Deploy Workflow'
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='relative'>
            <Button
              variant='outline'
              onClick={handleDeployClick}
              disabled={isDisabled}
              className={cn(
                'h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs',
                'hover:border-[var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hex)] hover:text-white',
                'transition-all duration-200',
                isDeployed && !isPreviousVersionActive && 'text-[var(--brand-primary-hover-hex)]',
                isPreviousVersionActive &&
                  'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400',
                isDisabled &&
                  'cursor-not-allowed opacity-50 hover:border hover:bg-card hover:text-card-foreground hover:shadow-xs'
              )}
            >
              {isDeploying ? (
                <Loader2 className='h-5 w-5 animate-spin' />
              ) : (
                <Rocket className='h-5 w-5' />
              )}
              <span className='sr-only'>Deploy API</span>
            </Button>

            {isDeployed && workflowNeedsRedeployment && (
              <div className='pointer-events-none absolute right-2 bottom-2 flex items-center justify-center'>
                <div className='relative'>
                  <div className='absolute inset-0 h-[6px] w-[6px] animate-ping rounded-full bg-amber-500/50' />
                  <div className='zoom-in fade-in relative h-[6px] w-[6px] animate-in rounded-full bg-amber-500/80 duration-300' />
                </div>
                <span className='sr-only'>Needs Redeployment</span>
              </div>
            )}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content>{getTooltipText()}</Tooltip.Content>
      </Tooltip.Root>

      <DeployModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        workflowId={activeWorkflowId}
        needsRedeployment={workflowNeedsRedeployment}
        setNeedsRedeployment={setNeedsRedeployment}
        deployedState={deployedState as WorkflowState}
        isLoadingDeployedState={isLoadingDeployedState}
        refetchDeployedState={refetchWithErrorHandling}
      />
    </>
  )
}
