'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
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
  const [viewDeploymentInfo, setViewDeploymentInfo] = useState(false)

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

  // Call fetchApiKeys when the modal opens
  useEffect(() => {
    if (open) {
      fetchApiKeys()
    }
  }, [open, workflowId])

  // Fetch deployment info when the modal opens and the workflow is deployed
  useEffect(() => {
    async function fetchDeploymentInfo() {
      if (!open || !workflowId || !isDeployed) {
        setDeploymentInfo(null)
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
  const onDeploy = async (data: DeployFormValues, chatDeploy = false) => {
    if (!workflowId) {
      addNotification('error', 'No active workflow to deploy', null)
      return
    }

    try {
      if (!chatDeploy) {
        setIsSubmitting(true)
      }

      // Deploy the workflow with the selected API key
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: data.apiKey,
          // Add chatDeploy flag if we implement it later
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

      setDeploymentInfo({
        isDeployed: true,
        deployedAt: deployedAt,
        apiKey: data.apiKey,
        endpoint,
        exampleCommand: `curl -X POST -H "X-API-Key: ${data.apiKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`,
        needsRedeployment: false,
      })

      // Show the deployment info view
      setViewDeploymentInfo(true)

      // No notification on successful deploy
    } catch (error: any) {
      logger.error('Error deploying workflow:', { error })
      addNotification('error', `Failed to deploy workflow: ${error.message}`, workflowId)
    } finally {
      if (!chatDeploy) {
        setIsSubmitting(false)
      }
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

      // Close the modal
      onOpenChange(false)
    } catch (error: any) {
      logger.error('Error redeploying workflow:', { error })
      addNotification('error', `Failed to redeploy workflow: ${error.message}`, workflowId)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reset view when modal is closed or reopened
  useEffect(() => {
    if (!open) {
      setViewDeploymentInfo(!!isDeployed)
    } else if (open && isDeployed) {
      setViewDeploymentInfo(true)
    }
  }, [open, isDeployed])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] flex flex-col p-0 gap-0" hideCloseButton>
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">
              {viewDeploymentInfo ? 'API Deployment' : 'Deploy Workflow'}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="pt-4 px-6 pb-6 flex-1 overflow-y-auto">
          {viewDeploymentInfo ? (
            <DeploymentInfo
              isLoading={isLoading}
              deploymentInfo={deploymentInfo}
              onRedeploy={handleRedeploy}
              onUndeploy={handleUndeploy}
              isSubmitting={isSubmitting}
              isUndeploying={isUndeploying}
            />
          ) : (
            <DeployForm
              apiKeys={apiKeys}
              keysLoaded={keysLoaded}
              endpointUrl={`${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${workflowId}/execute`}
              workflowId={workflowId || ''}
              onSubmit={onDeploy}
              getInputFormatExample={getInputFormatExample}
              onApiKeyCreated={fetchApiKeys}
            />
          )}
        </div>

        {!viewDeploymentInfo && (
          <div className="border-t px-6 py-4 flex justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => onDeploy({ apiKey: apiKeys.length > 0 ? apiKeys[0].key : '' })}
                disabled={isSubmitting || (!keysLoaded && !apiKeys.length)}
                variant="outline"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Deploying...
                  </>
                ) : (
                  'Deploy'
                )}
              </Button>

              <Button
                type="button"
                onClick={() => onDeploy({ apiKey: '' }, true)}
                disabled={isSubmitting || (!keysLoaded && !apiKeys.length)}
                className={cn(
                  // Base styles
                  'gap-2 font-medium',
                  // Brand color with hover states
                  'bg-[#802FFF] hover:bg-[#7028E6]',
                  // Hover effect with brand color
                  'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                  // Text color and transitions
                  'text-white transition-all duration-200',
                  // Running state animation
                  isSubmitting &&
                    'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
                  // Disabled state
                  'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
                )}
              >
                Chat Deploy
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
