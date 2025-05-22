'use client'

<<<<<<< HEAD
import { useEffect, useState } from 'react'
=======
import { useState, useEffect, useRef } from 'react'
>>>>>>> 2d314bcc (fix: deployed state preview persists across workflows)
import { Loader2, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { DeployModal } from '../deploy-modal/deploy-modal'

const _logger = createLogger('DeploymentControls')

interface DeploymentControlsProps {
  activeWorkflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
  deployedState: any
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
  // Use workflow-specific deployment status
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(activeWorkflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  // Prioritize workflow-specific needsRedeployment flag, but fall back to prop if needed
  const workflowNeedsRedeployment =
    deploymentStatus?.needsRedeployment !== undefined
      ? deploymentStatus.needsRedeployment
      : needsRedeployment

  const [isDeploying, _setIsDeploying] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Add a ref to track the last seen workflow ID and deployed state
  const lastWorkflowIdRef = useRef<string | null>(null)
  const lastDeployedStateRef = useRef<any>(null)
  
  // Log when workflow ID changes
  useEffect(() => {
    if (activeWorkflowId !== lastWorkflowIdRef.current) {
      logger.info('Workflow ID changed in DeploymentControls', {
        previousId: lastWorkflowIdRef.current,
        currentId: activeWorkflowId,
        timestamp: Date.now()
      });
      lastWorkflowIdRef.current = activeWorkflowId;
    }
  }, [activeWorkflowId]);
  
  // Log when deployed state changes
  useEffect(() => {
    if (deployedState && deployedState !== lastDeployedStateRef.current) {
      const blockIds = Object.keys(deployedState?.blocks || {});
      logger.info('Deployed state changed in DeploymentControls', {
        workflowId: activeWorkflowId,
        blockCount: blockIds.length,
        blockIds: JSON.stringify(blockIds.slice(0, 3)),
        isLoadingState: isLoadingDeployedState,
        timestamp: Date.now(),
        stateHash: JSON.stringify(deployedState).length
      });
      lastDeployedStateRef.current = deployedState;
    }
  }, [deployedState, activeWorkflowId, isLoadingDeployedState]);
  
  // Add wrapper around refetchDeployedState to track timing
  const refetchWithLogging = async () => {
    if (!activeWorkflowId) return;
    
    const fetchId = Date.now();
    logger.info('Starting deployedState refetch', {
      workflowId: activeWorkflowId,
      fetchId,
      timestamp: Date.now()
    });
    
    try {
      await refetchDeployedState();
      
      logger.info('Completed deployedState refetch', {
        workflowId: activeWorkflowId,
        fetchId,
        timestamp: Date.now(),
        duration: Date.now() - fetchId
      });
    } catch (error) {
      logger.error('Error in deployedState refetch', {
        workflowId: activeWorkflowId,
        fetchId,
        error,
        timestamp: Date.now()
      });
    }
  };

  // Update parent component when workflow-specific status changes
  useEffect(() => {
    if (
      deploymentStatus?.needsRedeployment !== undefined &&
      deploymentStatus.needsRedeployment !== needsRedeployment
    ) {
      setNeedsRedeployment(deploymentStatus.needsRedeployment)
    }
  }, [
    deploymentStatus?.needsRedeployment,
    needsRedeployment,
    setNeedsRedeployment,
    deploymentStatus,
  ])

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
        deployedState={deployedState}
        isLoadingDeployedState={isLoadingDeployedState}
        refetchDeployedState={refetchWithLogging}
      />
    </>
  )
}
