'use client'

import { useState } from 'react'
import { Info, Loader2 } from 'lucide-react'
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
import { ApiEndpoint } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/api-endpoint/api-endpoint'
import { ApiKey } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/api-key/api-key'
import { DeployStatus } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/deploy-status/deploy-status'
import { ExampleCommand } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/example-command/example-command'
import { DeployedWorkflowModal } from '../../../deployment-controls/components/deployed-workflow-modal'
import { useNotificationStore } from '@/stores/notifications/store'

interface DeploymentInfoProps {
  isLoading: boolean
  deploymentInfo: {
    isDeployed: boolean
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
  workflowId?: string
}

export function DeploymentInfo({
  isLoading,
  deploymentInfo,
  onRedeploy,
  onUndeploy,
  isSubmitting,
  isUndeploying,
  workflowId,
}: DeploymentInfoProps) {
  const [isViewingDeployed, setIsViewingDeployed] = useState(false)
  const [deployedWorkflowState, setDeployedWorkflowState] = useState<any>(null)
  const { addNotification } = useNotificationStore()

  const handleViewDeployed = async () => {
    if (!workflowId) {
      addNotification(
        'error',
        'Cannot view deployment: Workflow ID is missing',
        null
      )
      return
    }

    try {
      const response = await fetch(`/api/workflows/${workflowId}/deployed`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch deployed workflow')
      }

      const data = await response.json()
      
      if (data && data.deployedState) {
        setDeployedWorkflowState(data.deployedState)
        setIsViewingDeployed(true)
      } else {
        addNotification(
          'error',
          'Failed to view deployment: No deployment state found',
          workflowId
        )
      }
    } catch (error) {
      console.error('Error fetching deployed workflow:', error)
      addNotification(
        'error',
        `Failed to fetch deployed workflow: ${(error as Error).message}`,
        workflowId
      )
    }
  }

  if (isLoading || !deploymentInfo) {
    return (
      <div className="space-y-4 px-1 overflow-y-auto">
        {/* API Endpoint skeleton */}
        <div className="space-y-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>

        {/* API Key skeleton */}
        <div className="space-y-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>

        {/* Example Command skeleton */}
        <div className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>

        {/* Deploy Status and buttons skeleton */}
        <div className="flex items-center justify-between pt-2 mt-4">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4 px-1 overflow-y-auto">
        <div className="space-y-4">
          <ApiEndpoint endpoint={deploymentInfo.endpoint} />
          <ApiKey apiKey={deploymentInfo.apiKey} />
          <ExampleCommand command={deploymentInfo.exampleCommand} apiKey={deploymentInfo.apiKey} />
        </div>

        <div className="flex items-center justify-between pt-2 mt-4">
          <DeployStatus needsRedeployment={deploymentInfo.needsRedeployment} />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleViewDeployed}
            >
              View Deployment
            </Button>
            {deploymentInfo.needsRedeployment && (
              <Button variant="outline" size="sm" onClick={onRedeploy} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {isSubmitting ? 'Redeploying...' : 'Redeploy'}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isUndeploying}>
                  {isUndeploying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  {isUndeploying ? 'Undeploying...' : 'Undeploy'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Undeploy API</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to undeploy this workflow? This will remove the API endpoint
                    and make it unavailable to external users.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onUndeploy}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Undeploy
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {deployedWorkflowState && (
        <DeployedWorkflowModal
          isOpen={isViewingDeployed}
          onClose={() => setIsViewingDeployed(false)}
          deployedWorkflowState={deployedWorkflowState}
        />
      )}
    </>
  )
}
