'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  DeployForm,
  DeploymentInfo,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components'
import { ChatDeploy } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/chat-deploy'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployModal')

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
  deployedState: WorkflowState
  isLoadingDeployedState: boolean
  refetchDeployedState: () => Promise<void>
}

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
}

interface WorkflowDeploymentInfo {
  isDeployed: boolean
  deployedAt?: string
  apiKey: string
  endpoint: string
  exampleCommand: string
  needsRedeployment: boolean
}

interface DeployFormValues {
  apiKey: string
  newKeyName?: string
}

type TabView = 'api' | 'chat'

export function DeployModal({
  open,
  onOpenChange,
  workflowId,
  needsRedeployment,
  setNeedsRedeployment,
  deployedState,
  isLoadingDeployedState,
  refetchDeployedState,
}: DeployModalProps) {
  // Use registry store for deployment-related functions
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(workflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)

  // Local state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const [deploymentInfo, setDeploymentInfo] = useState<WorkflowDeploymentInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [keysLoaded, setKeysLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<TabView>('api')
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [apiDeployError, setApiDeployError] = useState<string | null>(null)
  const [chatExists, setChatExists] = useState(false)
  const [isChatFormValid, setIsChatFormValid] = useState(false)

  // Generate an example input format for the API request
  const getInputFormatExample = () => {
    let inputFormatExample = ''
    try {
      const blocks = Object.values(useWorkflowStore.getState().blocks)
      const starterBlock = blocks.find((block) => block.type === 'starter')

      if (starterBlock) {
        const inputFormat = useSubBlockStore.getState().getValue(starterBlock.id, 'inputFormat')

        if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
          const exampleData: Record<string, any> = {}
          inputFormat.forEach((field: any) => {
            if (field.name) {
              switch (field.type) {
                case 'string':
                  exampleData[field.name] = 'example'
                  break
                case 'number':
                  exampleData[field.name] = 42
                  break
                case 'boolean':
                  exampleData[field.name] = true
                  break
                case 'object':
                  exampleData[field.name] = { key: 'value' }
                  break
                case 'array':
                  exampleData[field.name] = [1, 2, 3]
                  break
              }
            }
          })

          inputFormatExample = ` -d '${JSON.stringify(exampleData)}'`
        }
      }
    } catch (error) {
      logger.error('Error generating input format example:', error)
    }

    return inputFormatExample
  }

  // Fetch API keys when modal opens
  const fetchApiKeys = async () => {
    if (!open) return

    try {
      setKeysLoaded(false)
      const response = await fetch('/api/users/me/api-keys')

      if (response.ok) {
        const data = await response.json()
        setApiKeys(data.keys || [])
        setKeysLoaded(true)
      }
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
      setKeysLoaded(true)
    }
  }

  // Fetch chat deployment info when modal opens
  const fetchChatDeploymentInfo = async () => {
    if (!open || !workflowId) return

    try {
      setIsLoading(true)
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (response.ok) {
        const data = await response.json()
        if (data.isDeployed && data.deployment) {
          setChatExists(true)
        } else {
          setChatExists(false)
        }
      } else {
        setChatExists(false)
      }
    } catch (error) {
      logger.error('Error fetching chat deployment info:', { error })
      setChatExists(false)
    } finally {
      setIsLoading(false)
    }
  }

  // Call fetchApiKeys when the modal opens
  useEffect(() => {
    if (open) {
      // Set loading state immediately when modal opens
      setIsLoading(true)
      fetchApiKeys()
      fetchChatDeploymentInfo()
      setActiveTab('api')
    }
  }, [open, workflowId])

  // Fetch deployment info when the modal opens and the workflow is deployed
  useEffect(() => {
    async function fetchDeploymentInfo() {
      if (!open || !workflowId || !isDeployed) {
        setDeploymentInfo(null)
        // Only reset loading if modal is closed
        if (!open) {
          setIsLoading(false)
        }
        return
      }

      try {
        setIsLoading(true)

        // Get deployment info
        const response = await fetch(`/api/workflows/${workflowId}/deploy`)

        if (!response.ok) {
          throw new Error('Failed to fetch deployment information')
        }

        const data = await response.json()
        const endpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
        const inputFormatExample = getInputFormatExample()

        setDeploymentInfo({
          isDeployed: data.isDeployed,
          deployedAt: data.deployedAt,
          apiKey: data.apiKey,
          endpoint,
          exampleCommand: `curl -X POST -H "X-API-Key: ${data.apiKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`,
          needsRedeployment,
        })
      } catch (error) {
        logger.error('Error fetching deployment info:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    fetchDeploymentInfo()
  }, [open, workflowId, isDeployed, needsRedeployment])

  // Handle form submission for deployment
  const onDeploy = async (data: DeployFormValues) => {
    // Reset any previous errors
    setApiDeployError(null)

    try {
      setIsSubmitting(true)

      // Deploy the workflow with the selected API key
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: data.apiKey,
          deployChatEnabled: false, // Separate chat deployment
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to deploy workflow')
      }

      const { isDeployed: newDeployStatus, deployedAt } = await response.json()

      // Update the store with the deployment status
      setDeploymentStatus(
        workflowId,
        newDeployStatus,
        deployedAt ? new Date(deployedAt) : undefined,
        data.apiKey
      )

      // Reset the needs redeployment flag
      setNeedsRedeployment(false)
      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
      }

      // Update the local deployment info
      const endpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
      const inputFormatExample = getInputFormatExample()

      const newDeploymentInfo = {
        isDeployed: true,
        deployedAt: deployedAt,
        apiKey: data.apiKey,
        endpoint,
        exampleCommand: `curl -X POST -H "X-API-Key: ${data.apiKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`,
        needsRedeployment: false,
      }

      setDeploymentInfo(newDeploymentInfo)

      // Fetch the updated deployed state after deployment
      await refetchDeployedState()

      // No notification on successful deploy
    } catch (error: any) {
      logger.error('Error deploying workflow:', { error })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle workflow undeployment
  const handleUndeploy = async () => {
    try {
      setIsUndeploying(true)

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to undeploy workflow')
      }

      // Update deployment status in the store
      setDeploymentStatus(workflowId, false)

      // Reset chat deployment info
      setChatExists(false)

      // Close the modal
      onOpenChange(false)
    } catch (error: any) {
      logger.error('Error undeploying workflow:', { error })
    } finally {
      setIsUndeploying(false)
    }
  }

  // Handle redeployment of workflow
  const handleRedeploy = async () => {
    try {
      setIsSubmitting(true)

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployChatEnabled: false, // Separate chat deployment
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to redeploy workflow')
      }

      const { isDeployed: newDeployStatus, deployedAt, apiKey } = await response.json()

      // Update deployment status in the store
      setDeploymentStatus(
        workflowId,
        newDeployStatus,
        deployedAt ? new Date(deployedAt) : undefined,
        apiKey
      )

      // Reset the needs redeployment flag
      setNeedsRedeployment(false)
      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
      }

      // Fetch the updated deployed state after redeployment
      await refetchDeployedState()
    } catch (error: any) {
      logger.error('Error redeploying workflow:', { error })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Custom close handler to ensure we clean up loading states
  const handleCloseModal = () => {
    setIsSubmitting(false)
    setChatSubmitting(false)
    onOpenChange(false)
  }

  // Handle chat form submission
  const handleChatSubmit = async () => {
    setChatSubmitting(true)

    try {
      // Check if workflow is deployed first
      if (!isDeployed) {
        // Deploy workflow first
        const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deployApiEnabled: true,
            deployChatEnabled: false,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to deploy workflow')
        }

        const { isDeployed: newDeployStatus, deployedAt, apiKey } = await response.json()

        // Update the store with the deployment status
        setDeploymentStatus(
          workflowId,
          newDeployStatus,
          deployedAt ? new Date(deployedAt) : undefined,
          apiKey
        )
      }

      // Trigger form submission in the ChatDeploy component
      const form = document.querySelector('.chat-deploy-form') as HTMLFormElement
      if (form) {
        form.requestSubmit()
      }
    } catch (error: any) {
      logger.error('Error auto-deploying workflow for chat:', { error })
      setChatSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleCloseModal}>
      <DialogContent
        className='flex max-h-[78vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Deploy Workflow</DialogTitle>
            <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleCloseModal}>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='flex flex-1 flex-col overflow-hidden'>
          <div className='flex h-14 flex-none items-center border-b px-6'>
            <div className='flex gap-2'>
              <button
                onClick={() => setActiveTab('api')}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  activeTab === 'api'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                API
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  activeTab === 'chat'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                Chat
              </button>
            </div>
          </div>

          <div className='flex-1 overflow-y-auto'>
            <div className='p-6'>
              {activeTab === 'api' && (
                <>
                  {isDeployed ? (
                    <DeploymentInfo
                      isLoading={isLoading}
                      deploymentInfo={deploymentInfo}
                      onRedeploy={handleRedeploy}
                      onUndeploy={handleUndeploy}
                      isSubmitting={isSubmitting}
                      isUndeploying={isUndeploying}
                      workflowId={workflowId}
                      deployedState={deployedState}
                      isLoadingDeployedState={isLoadingDeployedState}
                      getInputFormatExample={getInputFormatExample}
                    />
                  ) : (
                    <>
                      {apiDeployError && (
                        <div className='mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm'>
                          <div className='font-semibold'>API Deployment Error</div>
                          <div>{apiDeployError}</div>
                        </div>
                      )}
                      <div className='-mx-1 px-1'>
                        <DeployForm
                          apiKeys={apiKeys}
                          keysLoaded={keysLoaded}
                          endpointUrl={`${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`}
                          workflowId={workflowId || ''}
                          onSubmit={onDeploy}
                          getInputFormatExample={getInputFormatExample}
                          onApiKeyCreated={fetchApiKeys}
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {activeTab === 'chat' && (
                <ChatDeploy
                  workflowId={workflowId || ''}
                  deploymentInfo={deploymentInfo}
                  onChatExistsChange={setChatExists}
                  chatSubmitting={chatSubmitting}
                  setChatSubmitting={setChatSubmitting}
                  onValidationChange={setIsChatFormValid}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        {activeTab === 'api' && !isDeployed && (
          <div className='flex flex-shrink-0 justify-between border-t px-6 py-4'>
            <Button variant='outline' onClick={handleCloseModal}>
              Cancel
            </Button>

            <Button
              type='button'
              onClick={() => onDeploy({ apiKey: apiKeys.length > 0 ? apiKeys[0].key : '' })}
              disabled={isSubmitting || (!keysLoaded && !apiKeys.length)}
              className={cn(
                'gap-2 font-medium',
                'bg-[#802FFF] hover:bg-[#7028E6]',
                'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                'text-white transition-all duration-200',
                'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                  Deploying...
                </>
              ) : (
                'Deploy API'
              )}
            </Button>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className='flex flex-shrink-0 justify-between border-t px-6 py-4'>
            <Button variant='outline' onClick={handleCloseModal}>
              Cancel
            </Button>

            <Button
              type='button'
              onClick={handleChatSubmit}
              disabled={chatSubmitting || !isChatFormValid}
              className={cn(
                'gap-2 font-medium',
                'bg-[#802FFF] hover:bg-[#7028E6]',
                'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                'text-white transition-all duration-200',
                'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
              )}
            >
              {chatSubmitting ? (
                <>
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                  Deploying...
                </>
              ) : chatExists ? (
                'Update'
              ) : (
                'Deploy Chat'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
