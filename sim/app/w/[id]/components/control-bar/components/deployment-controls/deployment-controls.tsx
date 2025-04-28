'use client'

import { useState } from 'react'
import { Loader2, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { DeployModal } from '../deploy-modal/deploy-modal'

const logger = createLogger('DeploymentControls')

interface DeploymentControlsProps {
  activeWorkflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
}

export function DeploymentControls({
  activeWorkflowId,
  needsRedeployment,
  setNeedsRedeployment,
}: DeploymentControlsProps) {
  // Store hooks
  const { isDeployed } = useWorkflowStore()

  // Local state
  const [isDeploying, setIsDeploying] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  /**
   * Open the deployment modal
   */
  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenModal}
              disabled={isDeploying}
              className={cn('hover:text-[#802FFF]', isDeployed && 'text-[#802FFF]')}
            >
              {isDeploying ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Rocket className="h-5 w-5" />
              )}
              <span className="sr-only">Deploy API</span>
            </Button>

            {/* Improved redeploy indicator with animation */}
            {isDeployed && needsRedeployment && (
              <div className="absolute top-0.5 right-0.5 flex items-center justify-center">
                <div className="relative">
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-amber-500/50 animate-ping"></div>
                  <div className="relative w-2 h-2 rounded-full bg-amber-500 ring-1 ring-background animate-in zoom-in fade-in duration-300"></div>
                </div>
                <span className="sr-only">Needs Redeployment</span>
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {isDeploying
            ? 'Deploying...'
            : isDeployed && needsRedeployment
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
        needsRedeployment={needsRedeployment}
        setNeedsRedeployment={setNeedsRedeployment}
      />
    </>
  )
}
