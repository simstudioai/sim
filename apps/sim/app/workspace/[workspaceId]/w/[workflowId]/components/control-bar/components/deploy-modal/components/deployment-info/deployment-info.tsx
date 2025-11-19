'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import {
  ApiEndpoint,
  DeployStatus,
  ExampleCommand,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/deployment-info/components'
import { DeployedWorkflowModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deployment-controls/components/deployed-workflow-modal'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface WorkflowDeploymentInfo {
  isDeployed: boolean
  deployedAt?: string
  apiKey: string
  endpoint: string
  exampleCommand: string
  needsRedeployment: boolean
}

interface DeploymentInfoProps {
  isLoading: boolean
  deploymentInfo: WorkflowDeploymentInfo | null
  onRedeploy: () => void
  onUndeploy: () => void
  isSubmitting: boolean
  isUndeploying: boolean
  workflowId: string | null
  deployedState: WorkflowState
  isLoadingDeployedState: boolean
  getInputFormatExample?: (includeStreaming?: boolean) => string
  selectedStreamingOutputs: string[]
  onSelectedStreamingOutputsChange: (outputs: string[]) => void
  onLoadDeploymentComplete: () => void
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
  isLoadingDeployedState,
  getInputFormatExample,
  selectedStreamingOutputs,
  onSelectedStreamingOutputsChange,
  onLoadDeploymentComplete,
}: DeploymentInfoProps) {
  const [isViewingDeployed, setIsViewingDeployed] = useState(false)
  const [showUndeployModal, setShowUndeployModal] = useState(false)

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
          <ExampleCommand
            command={deploymentInfo.exampleCommand}
            apiKey={deploymentInfo.apiKey}
            endpoint={deploymentInfo.endpoint}
            getInputFormatExample={getInputFormatExample}
            workflowId={workflowId}
            selectedStreamingOutputs={selectedStreamingOutputs}
            onSelectedStreamingOutputsChange={onSelectedStreamingOutputsChange}
          />
        </div>

        <div className='mt-4 flex items-center justify-between pt-2'>
          <DeployStatus needsRedeployment={deploymentInfo.needsRedeployment} />

          <div className='flex gap-2'>
            <Button variant='outline' onClick={handleViewDeployed} className='h-8 text-xs'>
              View Deployment
            </Button>
            {deploymentInfo.needsRedeployment && (
              <Button
                variant='primary'
                onClick={onRedeploy}
                disabled={isSubmitting}
                className='h-8 text-xs'
              >
                {isSubmitting ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}
                {isSubmitting ? 'Redeploying...' : 'Redeploy'}
              </Button>
            )}
            <Button
              variant='outline'
              disabled={isUndeploying}
              className='h-8 text-xs'
              onClick={() => setShowUndeployModal(true)}
            >
              {isUndeploying ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}
              {isUndeploying ? 'Undeploying...' : 'Undeploy'}
            </Button>
          </div>
        </div>
      </div>

      {deployedState && workflowId && (
        <DeployedWorkflowModal
          isOpen={isViewingDeployed}
          onClose={() => setIsViewingDeployed(false)}
          needsRedeployment={deploymentInfo.needsRedeployment}
          activeDeployedState={deployedState}
          workflowId={workflowId}
          onLoadDeploymentComplete={onLoadDeploymentComplete}
        />
      )}

      {/* Undeploy Confirmation Modal */}
      <Modal open={showUndeployModal} onOpenChange={setShowUndeployModal}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Undeploy API</ModalTitle>
            <ModalDescription>
              Are you sure you want to undeploy this workflow? This will remove the API endpoint and
              make it unavailable to external users.{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button
              className='h-[32px] px-[12px]'
              variant='outline'
              onClick={() => setShowUndeployModal(false)}
              disabled={isUndeploying}
            >
              Cancel
            </Button>
            <Button
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
              onClick={() => {
                onUndeploy()
                setShowUndeployModal(false)
              }}
              disabled={isUndeploying}
            >
              {isUndeploying ? 'Undeploying...' : 'Undeploy'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
