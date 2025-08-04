import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger } from '@/triggers'
import { TriggerModal } from './components/trigger-modal'

const logger = createLogger('TriggerConfig')

interface TriggerConfigProps {
  blockId: string
  subBlockId?: string
  isConnecting: boolean
  isPreview?: boolean
  value?: {
    triggerId?: string
    triggerPath?: string
    triggerConfig?: Record<string, any>
  }
  disabled?: boolean
  triggerProvider?: string
  availableTriggers?: string[]
}

export function TriggerConfig({
  blockId,
  subBlockId,
  isConnecting,
  isPreview = false,
  value: propValue,
  disabled = false,
  triggerProvider,
  availableTriggers = [],
}: TriggerConfigProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [triggerId, setTriggerId] = useState<string | null>(null)
  const params = useParams()
  const workflowId = params.workflowId as string
  const [isLoading, setIsLoading] = useState(false)

  // Get trigger configuration from the block state
  const [storeTriggerProvider, setTriggerProvider] = useSubBlockValue(blockId, 'triggerProvider')
  const [storeTriggerPath, setTriggerPath] = useSubBlockValue(blockId, 'triggerPath')
  const [storeTriggerConfig, setTriggerConfig] = useSubBlockValue(blockId, 'triggerConfig')
  const [storeTriggerId, setStoredTriggerId] = useSubBlockValue(blockId, 'triggerId')

  // Use prop values when available (preview mode), otherwise use store values
  const selectedTriggerId = propValue?.triggerId ?? storeTriggerId ?? (availableTriggers[0] || null)
  const triggerPath = propValue?.triggerPath ?? storeTriggerPath
  const triggerConfig = propValue?.triggerConfig ?? storeTriggerConfig

  // Get the trigger definition - if no specific trigger is selected, use the first available one
  const triggerDef = selectedTriggerId
    ? getTrigger(selectedTriggerId)
    : availableTriggers[0]
      ? getTrigger(availableTriggers[0])
      : null

  // Set the trigger ID to the first available one if none is set
  useEffect(() => {
    if (!selectedTriggerId && availableTriggers[0] && !isPreview) {
      setStoredTriggerId(availableTriggers[0])
    }
  }, [availableTriggers, selectedTriggerId, setStoredTriggerId, isPreview])

  // Store the actual trigger from the database
  const [actualTriggerId, setActualTriggerId] = useState<string | null>(null)

  // Check if webhook exists in the database (using existing webhook API)
  useEffect(() => {
    // Skip API calls in preview mode
    if (isPreview) {
      setIsLoading(false)
      return
    }

    const checkWebhook = async () => {
      setIsLoading(true)
      try {
        // Check if there's a webhook for this specific block
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            setTriggerId(webhook.id)
            setActualTriggerId(webhook.provider)

            // Update the path in the block state if it's different
            if (webhook.path && webhook.path !== triggerPath) {
              setTriggerPath(webhook.path)
            }

            // Update trigger config (from webhook providerConfig)
            if (webhook.providerConfig) {
              setTriggerConfig(webhook.providerConfig)
            }
          } else {
            setTriggerId(null)
            setActualTriggerId(null)

            // Clear stale trigger data from store when no webhook found in database
            if (triggerPath) {
              setTriggerPath('')
              logger.info('Cleared stale trigger path on page refresh - no webhook in database', {
                blockId,
                clearedPath: triggerPath,
              })
            }
          }
        }
      } catch (error) {
        logger.error('Error checking webhook:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    const effectiveTriggerId = selectedTriggerId || availableTriggers[0]
    if (effectiveTriggerId) {
      checkWebhook()
    }
  }, [workflowId, blockId, isPreview, selectedTriggerId, availableTriggers])

  const handleOpenModal = () => {
    if (isPreview || disabled) return
    setIsModalOpen(true)
    setError(null)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSaveTrigger = async (path: string, config: Record<string, any>) => {
    const effectiveTriggerId = selectedTriggerId || availableTriggers[0]
    if (isPreview || disabled || !effectiveTriggerId) return false

    try {
      setIsSaving(true)
      setError(null)

      // Set the trigger path and config in the block state
      if (path && path !== triggerPath) {
        setTriggerPath(path)
      }
      setTriggerConfig(config)
      setStoredTriggerId(effectiveTriggerId)

      // Map trigger ID to webhook provider name
      const webhookProvider = effectiveTriggerId.replace('_webhook', '') // e.g., 'slack_webhook' -> 'slack'

      // Save as webhook using existing webhook API
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          blockId,
          path,
          provider: webhookProvider,
          providerConfig: config,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(
          typeof errorData.error === 'object'
            ? errorData.error.message || JSON.stringify(errorData.error)
            : errorData.error || 'Failed to save trigger'
        )
      }

      const data = await response.json()
      const savedWebhookId = data.webhook.id
      setTriggerId(savedWebhookId)

      logger.info('Trigger saved successfully as webhook', {
        webhookId: savedWebhookId,
        triggerDefId: selectedTriggerId,
        provider: webhookProvider,
        path,
        blockId,
      })

      // Update the actual trigger after saving
      setActualTriggerId(webhookProvider)

      return true
    } catch (error: any) {
      logger.error('Error saving trigger:', { error })
      setError(error.message || 'Failed to save trigger configuration')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTrigger = async () => {
    if (isPreview || disabled || !triggerId) return false

    try {
      setIsDeleting(true)
      setError(null)

      // Delete webhook using existing webhook API
      const response = await fetch(`/api/webhooks/${triggerId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete trigger')
      }

      // Remove trigger-specific fields from the block state
      const store = useSubBlockStore.getState()
      const workflowValues = store.workflowValues[workflowId] || {}
      const blockValues = { ...workflowValues[blockId] }

      // Remove trigger-related fields
      blockValues.triggerId = undefined
      blockValues.triggerConfig = undefined
      blockValues.triggerPath = undefined

      // Update the store with the cleaned block values
      useSubBlockStore.setState({
        workflowValues: {
          ...workflowValues,
          [workflowId]: {
            ...workflowValues,
            [blockId]: blockValues,
          },
        },
      })

      // Clear component state
      setTriggerId(null)
      setActualTriggerId(null)

      handleCloseModal()

      return true
    } catch (error: any) {
      logger.error('Error deleting trigger:', { error })
      setError(error.message || 'Failed to delete trigger')
      return false
    } finally {
      setIsDeleting(false)
    }
  }

  // Get trigger icon and name
  const getTriggerInfo = () => {
    if (!triggerDef) return null

    return {
      name: triggerDef.name,
      icon: null, // We'll add icons later
    }
  }

  // Check if the trigger is connected (similar to webhook logic)
  const effectiveTriggerId = selectedTriggerId || availableTriggers[0]
  const isTriggerConnected = Boolean(triggerId && actualTriggerId)

  // Debug logging to help with troubleshooting
  useEffect(() => {
    logger.info('Trigger connection status:', {
      triggerId,
      actualTriggerId,
      triggerPath,
      isTriggerConnected,
      effectiveTriggerId,
    })
  }, [triggerId, actualTriggerId, triggerPath, isTriggerConnected, effectiveTriggerId])

  return (
    <div className='w-full'>
      {error && <div className='mb-2 text-red-500 text-sm dark:text-red-400'>{error}</div>}

      {isTriggerConnected ? (
        <div className='flex flex-col space-y-2'>
          <div
            className='flex h-10 cursor-pointer items-center justify-center rounded border border-border bg-background px-3 py-2 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground'
            onClick={handleOpenModal}
          >
            <div className='flex items-center gap-2'>
              <div className='flex items-center'>
                {triggerDef?.icon && (
                  <triggerDef.icon className='mr-2 h-4 w-4 text-[#611f69] dark:text-[#e01e5a]' />
                )}
                <span className='font-normal text-sm'>
                  {getTriggerInfo()?.name || 'Active Trigger'}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          className='flex h-10 w-full items-center bg-background font-normal text-sm'
          onClick={handleOpenModal}
          disabled={
            isConnecting || isSaving || isDeleting || isPreview || disabled || !selectedTriggerId
          }
        >
          {isLoading ? (
            <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          ) : (
            <ExternalLink className='mr-2 h-4 w-4' />
          )}
          Configure Trigger
        </Button>
      )}

      {isModalOpen && triggerDef && (
        <TriggerModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          triggerPath={triggerPath || ''}
          triggerDef={triggerDef}
          triggerConfig={triggerConfig || {}}
          onSave={handleSaveTrigger}
          onDelete={handleDeleteTrigger}
          triggerId={triggerId || undefined}
          blockId={blockId}
        />
      )}
    </div>
  )
}
