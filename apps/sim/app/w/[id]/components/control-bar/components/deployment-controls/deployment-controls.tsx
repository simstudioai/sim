'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { DeployModal } from '../deploy-modal/deploy-modal'

interface DeploymentControlsProps {
  activeWorkflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
  refetchDeployedState: () => Promise<void>
}

export function DeploymentControls({
  activeWorkflowId,
  needsRedeployment,
  setNeedsRedeployment,
  deployedState,
  isLoadingDeployedState,
  refetchDeployedState,
}: DeploymentControlsProps) {
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(activeWorkflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  const workflowNeedsRedeployment = needsRedeployment

  const [isDeploying, _setIsDeploying] = useState(false)
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

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='relative'>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setIsModalOpen(true)}
              disabled={isDeploying}
              className={cn('hover:text-[#802FFF]', isDeployed && 'text-[#802FFF]')}
            >
              {isDeploying ? (
                <Loader2 className='h-5 w-5 animate-spin' />
              ) : (
                <Rocket className='h-5 w-5' />
              )}
              <span className='sr-only'>Deploy API</span>
            </Button>

            {isDeployed && workflowNeedsRedeployment && (
              <div className='absolute top-0.5 right-0.5 flex items-center justify-center'>
                <div className='relative'>
                  <div className='absolute inset-0 h-2 w-2 animate-ping rounded-full bg-amber-500/50' />
                  <div className='zoom-in fade-in relative h-2 w-2 animate-in rounded-full bg-amber-500 ring-1 ring-background duration-300' />
                </div>
                <span className='sr-only'>Needs Redeployment</span>
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {isDeploying
            ? 'Deploying...'
            : isDeployed && workflowNeedsRedeployment
              ? 'Workflow changes detected'
              : isDeployed
                ? 'Deployment Settings'
                : 'Deploy as API'}
        </TooltipContent>
      </Tooltip>

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
