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
import { LoadingAgent } from '@/components/ui/loading-agent'
import { DeployStatus } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deploy-status/deploy-status'
import { ApiEndpoint } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/api-endpoint/api-endpoint'
import { ApiKey } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/api-key/api-key'
import { ExampleCommand } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/components/example-command/example-command'

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
}

export function DeploymentInfo({
  isLoading,
  deploymentInfo,
  onRedeploy,
  onUndeploy,
  isSubmitting,
  isUndeploying,
}: DeploymentInfoProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingAgent size="md" />
      </div>
    )
  }

  if (!deploymentInfo) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Info className="h-5 w-5" />
          <p className="text-sm">No deployment information available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 px-1 overflow-y-auto">
      <ApiEndpoint endpoint={deploymentInfo.endpoint} />
      <ApiKey apiKey={deploymentInfo.apiKey} />
      <ExampleCommand command={deploymentInfo.exampleCommand} apiKey={deploymentInfo.apiKey} />

      <div className="flex items-center justify-between pt-2">
        <DeployStatus needsRedeployment={deploymentInfo.needsRedeployment} />

        <div className="flex gap-2">
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
  )
}
