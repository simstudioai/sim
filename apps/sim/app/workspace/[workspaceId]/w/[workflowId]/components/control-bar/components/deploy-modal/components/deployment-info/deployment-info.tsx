'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiEndpoint } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/deployment-info/components/api-endpoint/api-endpoint'
import { ApiKey } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/deployment-info/components/api-key/api-key'
import { DeployStatus } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/deployment-info/components/deploy-status/deploy-status'
import { ExampleCommand } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/deployment-info/components/example-command/example-command'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { DeployedWorkflowModal } from '../../../deployment-controls/components/deployed-workflow-modal'

interface DeploymentInfoProps {
  isLoading?: boolean
  deploymentInfo: {
    deployedAt?: string
    apiKey: string
    endpoint: string
    exampleCommand: string
    needsRedeployment: boolean
  } | null
  onRedeploy: () => void
  onUndeploy: () => void
  isSubmitting: boolean
  isUndeploying: boolean
  workflowId: string | null
  deployedState: WorkflowState
  isLoadingDeployedState: boolean
}

export function DeploymentInfo({
  isLoading,
  deploymentInfo,
  onRedeploy,
  onUndeploy,
  isSubmitting,
  isUndeploying,
  workflowId,
  deployedState,
}: DeploymentInfoProps) {
  const [isViewingDeployed, setIsViewingDeployed] = useState(false)

  const handleViewDeployed = async () => {
    if (!workflowId) {
      return
    }

    // If deployedState is already loaded, use it directly
    if (deployedState) {
      setIsViewingDeployed(true)
      return
    }
  }

  if (isLoading || !deploymentInfo) {
    return (
      <div className='space-y-4 overflow-y-auto px-1'>
        {/* API Endpoint skeleton */}
        <div className='space-y-3'>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='h-10 w-full' />
        </div>

        {/* API Key skeleton */}
        <div className='space-y-3'>
          <Skeleton className='h-5 w-20' />
          <Skeleton className='h-10 w-full' />
        </div>

        {/* Example Command skeleton */}
        <div className='space-y-3'>
          <Skeleton className='h-5 w-36' />
          <Skeleton className='h-24 w-full rounded-md' />
        </div>

        {/* Deploy Status and buttons skeleton */}
        <div className='mt-4 flex items-center justify-between pt-2'>
          <Skeleton className='h-6 w-32' />
          <div className='flex gap-2'>
            <Skeleton className='h-9 w-24' />
            <Skeleton className='h-9 w-24' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className='space-y-4 overflow-y-auto px-1'>
        <div className='space-y-4'>
          <ApiEndpoint endpoint={deploymentInfo.endpoint} />
          <ApiKey apiKey={deploymentInfo.apiKey} />
          <ExampleCommand command={deploymentInfo.exampleCommand} apiKey={deploymentInfo.apiKey} />
        </div>

        <div className='mt-4 flex items-center justify-between pt-2'>
          <DeployStatus needsRedeployment={deploymentInfo.needsRedeployment} />

          <div className='flex gap-2'>
            <Button variant='outline' size='sm' onClick={handleViewDeployed}>
              View Deployment
            </Button>
            {deploymentInfo.needsRedeployment && (
              <Button variant='outline' size='sm' onClick={onRedeploy} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}
                {isSubmitting ? 'Redeploying...' : 'Redeploy'}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant='destructive' size='sm' disabled={isUndeploying}>
                  {isUndeploying ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}
                  {isUndeploying ? 'Undeploying...' : 'Undeploy'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Undeploy API</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to undeploy this workflow? This will remove the API
                    endpoint and make it unavailable to external users.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onUndeploy}
                    className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  >
                    Undeploy
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {deployedState && (
        <DeployedWorkflowModal
          isOpen={isViewingDeployed}
          onClose={() => setIsViewingDeployed(false)}
          needsRedeployment={deploymentInfo.needsRedeployment}
          deployedWorkflowState={deployedState}
        />
      )}
    </>
  )
}
