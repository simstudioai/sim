'use client'

import { useState } from 'react'
import { Loader2, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
  const { addNotification, showNotification, removeNotification, notifications } =
    useNotificationStore()
  const { isDeployed, setDeploymentStatus } = useWorkflowStore()

  // Local state
  const [isDeploying, setIsDeploying] = useState(false)

  /**
   * Get an example of the input format for the workflow
   */
  const getInputFormatExample = () => {
    let inputFormatExample = ''
    try {
      // Find the starter block in the workflow
      const blocks = Object.values(useWorkflowStore.getState().blocks)
      const starterBlock = blocks.find((block) => block.type === 'starter')

      if (starterBlock) {
        const inputFormat = useSubBlockStore.getState().getValue(starterBlock.id, 'inputFormat')

        // If input format is defined, create an example
        if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
          const exampleData: Record<string, any> = {}

          // Create example values for each field
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

  /**
   * Helper to create API notification with consistent format
   */
  const createApiNotification = (
    message: string,
    workflowId: string,
    apiKey: string,
    needsRedeployment = false
  ) => {
    const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${workflowId}/execute`
    const inputFormatExample = getInputFormatExample()

    return addNotification('api', message, workflowId, {
      isPersistent: true,
      sections: [
        {
          label: 'API Endpoint',
          content: endpoint,
        },
        {
          label: 'API Key',
          content: apiKey || 'No API key found. Visit your account settings to create one.',
        },
        {
          label: 'Example curl command',
          content: apiKey
            ? `curl -X POST -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`
            : `You need an API key to call this endpoint. Visit your account settings to create one.`,
        },
      ],
      needsRedeployment,
    })
  }

  /**
   * Workflow deployment handler
   */
  const handleDeploy = async () => {
    if (!activeWorkflowId) return

    // If already deployed, show the API info
    if (isDeployed) {
      // Try to find an existing API notification
      const apiNotification = notifications.find(
        (n) => n.type === 'api' && n.workflowId === activeWorkflowId
      )

      if (apiNotification) {
        // Before showing existing notification, check if we need to update it with current status
        if (apiNotification.options?.needsRedeployment !== needsRedeployment) {
          // Remove old notification
          removeNotification(apiNotification.id)

          // Fetch API key from the existing notification
          const apiKey =
            apiNotification.options?.sections?.find((s) => s.label === 'API Key')?.content || ''

          createApiNotification(
            needsRedeployment
              ? 'Workflow changes detected - Redeploy needed'
              : 'Workflow deployment information',
            activeWorkflowId,
            apiKey,
            needsRedeployment
          )
        } else {
          // Show existing notification if status hasn't changed
          showNotification(apiNotification.id)
        }
        return
      }

      // If notification not found but workflow is deployed, fetch deployment info
      try {
        setIsDeploying(true)

        const response = await fetch(`/api/workflows/${activeWorkflowId}/deploy`)
        if (!response.ok) throw new Error('Failed to fetch deployment info')

        // Get needsRedeployment info from status endpoint
        const statusResponse = await fetch(`/api/workflows/${activeWorkflowId}/status`)
        const statusData = await statusResponse.json()
        const needsRedeployment = statusData.needsRedeployment || false

        const { apiKey } = await response.json()

        // Create a new notification with the deployment info
        createApiNotification(
          needsRedeployment
            ? 'Workflow changes detected - Redeploy needed'
            : 'Workflow deployment information',
          activeWorkflowId,
          apiKey,
          needsRedeployment
        )
      } catch (error) {
        addNotification('error', 'Failed to fetch deployment information', activeWorkflowId)
      } finally {
        setIsDeploying(false)
      }
      return
    }

    // If not deployed, proceed with deployment
    try {
      setIsDeploying(true)

      const response = await fetch(`/api/workflows/${activeWorkflowId}/deploy`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to deploy workflow')

      const { apiKey, isDeployed: newDeployStatus, deployedAt } = await response.json()

      // Update the store with the deployment status
      setDeploymentStatus(newDeployStatus, deployedAt ? new Date(deployedAt) : undefined)

      // Reset the needs redeployment flag since we just deployed
      setNeedsRedeployment(false)

      createApiNotification('Workflow successfully deployed', activeWorkflowId, apiKey)
    } catch (error) {
      addNotification('error', 'Failed to deploy workflow. Please try again.', activeWorkflowId)
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDeploy}
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
            : 'Deployment Settings'}
      </TooltipContent>
    </Tooltip>
  )
}
