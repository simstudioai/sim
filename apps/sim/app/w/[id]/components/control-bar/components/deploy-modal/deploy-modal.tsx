'use client'

import { useEffect, useState } from 'react'
import { Info, Loader2, X } from 'lucide-react'
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
import { Card, CardContent } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TabsContent } from '@/components/ui/tabs'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ChatDeploy } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/chat-deploy/chat-deploy'
import { DeployForm } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deploy-form/deploy-form'
import { DeploymentInfo } from '@/app/w/[id]/components/control-bar/components/deploy-modal/components/deployment-info/deployment-info'

const logger = createLogger('DeployModal')

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
}

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
}

interface DeploymentInfo {
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
}: DeployModalProps) {
  // Store hooks
  const { addNotification } = useNotificationStore()
  const { isDeployed, setDeploymentStatus } = useWorkflowStore()

  // Local state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const [deploymentInfo, setDeploymentInfo] = useState<DeploymentInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [keysLoaded, setKeysLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<TabView>('api')
  const [isChatDeploying, setIsChatDeploying] = useState(false)
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [apiDeployError, setApiDeployError] = useState<string | null>(null)
  const [chatExists, setChatExists] = useState(false)
  const [deployedChatUrl, setDeployedChatUrl] = useState<string | null>(null)
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)

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
      const response = await fetch('/api/user/api-keys')

      if (response.ok) {
        const data = await response.json()
        setApiKeys(data.keys || [])
        setKeysLoaded(true)
      }
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
      addNotification('error', 'Failed to fetch API keys', workflowId)
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
        if (data.isDeployed && data.deployment && data.deployment.chatUrl) {
          setDeployedChatUrl(data.deployment.chatUrl)
          setChatExists(true)
        } else {
          setDeployedChatUrl(null)
          setChatExists(false)
        }
      } else {
        setDeployedChatUrl(null)
        setChatExists(false)
      }
    } catch (error) {
      logger.error('Error fetching chat deployment info:', { error })
      setDeployedChatUrl(null)
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
        const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${workflowId}/execute`
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
        addNotification('error', 'Failed to fetch deployment information', workflowId)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDeploymentInfo()
  }, [open, workflowId, isDeployed, addNotification, needsRedeployment])

  // Handle form submission for deployment
  const onDeploy = async (data: DeployFormValues) => {
    if (!workflowId) {
      addNotification('error', 'No active workflow to deploy', null)
      return
    }

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
      setDeploymentStatus(newDeployStatus, deployedAt ? new Date(deployedAt) : undefined)

      // Reset the needs redeployment flag
      setNeedsRedeployment(false)

      // Update the local deployment info
      const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${workflowId}/execute`
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

      // No notification on successful deploy
    } catch (error: any) {
      logger.error('Error deploying workflow:', { error })
      addNotification('error', `Failed to deploy workflow: ${error.message}`, workflowId)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle workflow undeployment
  const handleUndeploy = async () => {
    if (!workflowId) {
      addNotification('error', 'No active workflow to undeploy', null)
      return
    }

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
      setDeploymentStatus(false)

      // Reset chat deployment info
      setDeployedChatUrl(null)
      setChatExists(false)

      // Add a success notification
      addNotification('info', 'Workflow successfully undeployed', workflowId)

      // Close the modal
      onOpenChange(false)
    } catch (error: any) {
      logger.error('Error undeploying workflow:', { error })
      addNotification('error', `Failed to undeploy workflow: ${error.message}`, workflowId)
    } finally {
      setIsUndeploying(false)
    }
  }

  // Handle redeployment of workflow
  const handleRedeploy = async () => {
    if (!workflowId) {
      addNotification('error', 'No active workflow to redeploy', null)
      return
    }

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

      const { isDeployed: newDeployStatus, deployedAt } = await response.json()

      // Update deployment status in the store
      setDeploymentStatus(newDeployStatus, deployedAt ? new Date(deployedAt) : undefined)

      // Reset the needs redeployment flag
      setNeedsRedeployment(false)

      // Add a success notification
      addNotification('info', 'Workflow successfully redeployed', workflowId)
    } catch (error: any) {
      logger.error('Error redeploying workflow:', { error })
      addNotification('error', `Failed to redeploy workflow: ${error.message}`, workflowId)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Custom close handler to ensure we clean up loading states
  const handleCloseModal = () => {
    // Reset all loading states
    setIsSubmitting(false)
    setIsChatDeploying(false)
    setChatSubmitting(false)
    onOpenChange(false)
  }

  // Add a new handler for chat undeploy
  const handleChatUndeploy = async () => {
    if (!workflowId) {
      addNotification('error', 'No active workflow to undeploy chat', null)
      return
    }

    try {
      setIsUndeploying(true)

      // First get the chat deployment info
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to get chat info')
      }

      const data = await response.json()

      if (!data.isDeployed || !data.deployment || !data.deployment.id) {
        throw new Error('No active chat deployment found')
      }

      // Delete the chat
      const deleteResponse = await fetch(`/api/chat/edit/${data.deployment.id}`, {
        method: 'DELETE',
      })

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json()
        throw new Error(errorData.error || 'Failed to undeploy chat')
      }

      // Reset chat deployment info
      setDeployedChatUrl(null)
      setChatExists(false)

      // Add a success notification
      addNotification('info', 'Chat successfully undeployed', workflowId)

      // Close the modal
      onOpenChange(false)
    } catch (error: any) {
      logger.error('Error undeploying chat:', { error })
      addNotification('error', `Failed to undeploy chat: ${error.message}`, workflowId)
    } finally {
      setIsUndeploying(false)
      setShowDeleteConfirmation(false)
    }
  }

  // Find or create appropriate method to handle chat deployment
  const handleChatSubmit = async () => {
    if (!workflowId) {
      addNotification('error', 'No active workflow to deploy', null)
      return
    }

    // Check if workflow is deployed
    if (!isDeployed) {
      // Deploy workflow first
      try {
        setChatSubmitting(true)

        // Call the API to deploy the workflow
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

        const { isDeployed: newDeployStatus, deployedAt } = await response.json()

        // Update the store with the deployment status
        setDeploymentStatus(newDeployStatus, deployedAt ? new Date(deployedAt) : undefined)

        logger.info('Workflow automatically deployed for chat deployment')
      } catch (error: any) {
        logger.error('Error auto-deploying workflow for chat:', { error })
        addNotification('error', `Failed to deploy workflow: ${error.message}`, workflowId)
        setChatSubmitting(false)
        return
      }
    }

    // Now submit the chat deploy form
    const form = document.querySelector('.chat-deploy-form') as HTMLFormElement
    if (form) {
      form.requestSubmit()
    }
  }

  const handleChatDeploymentComplete = () => {
    setChatSubmitting(false)
  }

  // Render deployed chat view
  const renderDeployedChatView = () => {
    if (!deployedChatUrl) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Info className="h-5 w-5" />
            <p className="text-sm">No chat deployment information available</p>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20">
          <CardContent className="p-6 text-green-800 dark:text-green-400">
            <h3 className="text-base font-medium mb-2">Chat Deployment Active</h3>
            <p className="mb-3">Your chat is available at:</p>
            <div className="bg-white/50 dark:bg-gray-900/50 p-3 rounded-md border border-green-200 dark:border-green-900/50 relative group">
              <a
                href={deployedChatUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary underline break-all block pr-8"
              >
                {deployedChatUrl}
              </a>
              <CopyButton text={deployedChatUrl || ''} />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleCloseModal}>
      <DialogContent
        className="sm:max-w-[600px] max-h-[78vh] flex flex-col p-0 gap-0 overflow-hidden"
        hideCloseButton
      >
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">Deploy Workflow</DialogTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8 p-0" onClick={handleCloseModal}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-none flex items-center h-14 px-6 border-b">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('api')}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  activeTab === 'api'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                API
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  activeTab === 'chat'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                Chat
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
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
                      workflowId={workflowId || undefined}
                    />
                  ) : (
                    <>
                      {apiDeployError && (
                        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
                          <div className="font-semibold">API Deployment Error</div>
                          <div>{apiDeployError}</div>
                        </div>
                      )}
                      <div className="px-1 -mx-1">
                        <DeployForm
                          apiKeys={apiKeys}
                          keysLoaded={keysLoaded}
                          endpointUrl={`${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${workflowId}/execute`}
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
                  onClose={() => onOpenChange(false)}
                  deploymentInfo={deploymentInfo}
                  onChatExistsChange={setChatExists}
                  showDeleteConfirmation={showDeleteConfirmation}
                  setShowDeleteConfirmation={setShowDeleteConfirmation}
                  onDeploymentComplete={handleChatDeploymentComplete}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        {activeTab === 'api' && !isDeployed && (
          <div className="border-t px-6 py-4 flex justify-between flex-shrink-0">
            <Button variant="outline" onClick={handleCloseModal}>
              Cancel
            </Button>

            <Button
              type="button"
              onClick={() => onDeploy({ apiKey: apiKeys.length > 0 ? apiKeys[0].key : '' })}
              disabled={isSubmitting || (!keysLoaded && !apiKeys.length) || isChatDeploying}
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
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Deploying...
                </>
              ) : (
                'Deploy API'
              )}
            </Button>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="border-t px-6 py-4 flex justify-between flex-shrink-0">
            <Button variant="outline" onClick={handleCloseModal}>
              Cancel
            </Button>

            <div className="flex gap-2">
              {chatExists && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={chatSubmitting || isUndeploying}>
                      {isUndeploying ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          Undeploying...
                        </>
                      ) : (
                        'Delete'
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Chat</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this chat? This will remove the chat
                        interface and make it unavailable to external users.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleChatUndeploy}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                type="button"
                onClick={handleChatSubmit}
                disabled={chatSubmitting}
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
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    {isDeployed
                      ? chatExists
                        ? 'Updating...'
                        : 'Deploying...'
                      : 'Deploying Workflow...'}
                  </>
                ) : chatExists ? (
                  'Update'
                ) : (
                  'Deploy Chat'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
