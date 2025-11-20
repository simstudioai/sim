import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { getBlock } from '@/blocks'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getTrigger, isTriggerValid } from '@/triggers'
import { populateTriggerFieldsFromConfig } from './use-trigger-config-aggregation'

const logger = createLogger('useWebhookManagement')

interface UseWebhookManagementProps {
  blockId: string
  triggerId?: string
  isPreview?: boolean
}

interface WebhookManagementState {
  webhookUrl: string
  webhookPath: string
  webhookId: string | null
  isLoading: boolean
  isSaving: boolean
  saveConfig: () => Promise<boolean>
  deleteConfig: () => Promise<boolean>
}

/**
 * Resolves the effective triggerId from various sources in order of priority
 */
function resolveEffectiveTriggerId(
  blockId: string,
  triggerId: string | undefined,
  webhook?: { providerConfig?: { triggerId?: string } }
): string | undefined {
  if (triggerId && isTriggerValid(triggerId)) {
    return triggerId
  }

  const selectedTriggerId = useSubBlockStore.getState().getValue(blockId, 'selectedTriggerId')
  if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
    return selectedTriggerId
  }

  const storedTriggerId = useSubBlockStore.getState().getValue(blockId, 'triggerId')
  if (typeof storedTriggerId === 'string' && isTriggerValid(storedTriggerId)) {
    return storedTriggerId
  }

  if (webhook?.providerConfig?.triggerId && typeof webhook.providerConfig.triggerId === 'string') {
    return webhook.providerConfig.triggerId
  }

  const workflowState = useWorkflowStore.getState()
  const block = workflowState.blocks?.[blockId]
  if (block) {
    const blockConfig = getBlock(block.type)
    if (blockConfig) {
      if (blockConfig.category === 'triggers') {
        return block.type
      }
      if (block.triggerMode && blockConfig.triggers?.enabled) {
        const selectedTriggerIdValue = block.subBlocks?.selectedTriggerId?.value
        const triggerIdValue = block.subBlocks?.triggerId?.value
        return (
          (typeof selectedTriggerIdValue === 'string' && isTriggerValid(selectedTriggerIdValue)
            ? selectedTriggerIdValue
            : undefined) ||
          (typeof triggerIdValue === 'string' && isTriggerValid(triggerIdValue)
            ? triggerIdValue
            : undefined) ||
          blockConfig.triggers?.available?.[0]
        )
      }
    }
  }

  return undefined
}

/**
 * Hook to manage webhook lifecycle for trigger blocks
 * Handles:
 * - Pre-generating webhook URLs based on blockId (without creating webhook)
 * - Loading existing webhooks from the API
 * - Saving and deleting webhook configurations
 */
export function useWebhookManagement({
  blockId,
  triggerId,
  isPreview = false,
}: UseWebhookManagementProps): WebhookManagementState {
  const params = useParams()
  const workflowId = params.workflowId as string

  const triggerDef = triggerId && isTriggerValid(triggerId) ? getTrigger(triggerId) : null

  const webhookId = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'webhookId') as string | null, [blockId])
  )
  const webhookPath = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'triggerPath') as string | null, [blockId])
  )
  const isLoading = useSubBlockStore((state) => state.loadingWebhooks.has(blockId))
  const isChecked = useSubBlockStore((state) => state.checkedWebhooks.has(blockId))

  const webhookUrl = useMemo(() => {
    if (!webhookPath) {
      const baseUrl = getBaseUrl()
      return `${baseUrl}/api/webhooks/trigger/${blockId}`
    }
    const baseUrl = getBaseUrl()
    return `${baseUrl}/api/webhooks/trigger/${webhookPath}`
  }, [webhookPath, blockId])

  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (triggerId && !isPreview) {
      const storedTriggerId = useSubBlockStore.getState().getValue(blockId, 'triggerId')
      if (storedTriggerId !== triggerId) {
        useSubBlockStore.getState().setValue(blockId, 'triggerId', triggerId)
      }
    }
  }, [triggerId, blockId, isPreview])

  useEffect(() => {
    if (isPreview) {
      return
    }

    const store = useSubBlockStore.getState()
    const currentlyLoading = store.loadingWebhooks.has(blockId)
    const alreadyChecked = store.checkedWebhooks.has(blockId)
    const currentWebhookId = store.getValue(blockId, 'webhookId')

    if (currentlyLoading || (alreadyChecked && currentWebhookId)) {
      return
    }

    const loadWebhookOrGenerateUrl = async () => {
      useSubBlockStore.setState((state) => ({
        loadingWebhooks: new Set([...state.loadingWebhooks, blockId]),
      }))

      try {
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)

        if (response.ok) {
          const data = await response.json()

          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook

            useSubBlockStore.getState().setValue(blockId, 'webhookId', webhook.id)
            logger.info('Webhook loaded from API', {
              blockId,
              webhookId: webhook.id,
              hasProviderConfig: !!webhook.providerConfig,
            })

            if (webhook.path) {
              useSubBlockStore.getState().setValue(blockId, 'triggerPath', webhook.path)
            }

            if (webhook.providerConfig) {
              const effectiveTriggerId = resolveEffectiveTriggerId(blockId, triggerId, webhook)

              useSubBlockStore.getState().setValue(blockId, 'triggerConfig', webhook.providerConfig)

              if (effectiveTriggerId) {
                populateTriggerFieldsFromConfig(blockId, webhook.providerConfig, effectiveTriggerId)
              } else {
                logger.warn('Cannot migrate - triggerId not available', {
                  blockId,
                  propTriggerId: triggerId,
                  providerConfigTriggerId: webhook.providerConfig.triggerId,
                })
              }
            }
          } else {
            useSubBlockStore.getState().setValue(blockId, 'webhookId', null)
          }

          useSubBlockStore.setState((state) => ({
            checkedWebhooks: new Set([...state.checkedWebhooks, blockId]),
          }))
        } else {
          logger.warn('API response not OK', {
            blockId,
            workflowId,
            status: response.status,
            statusText: response.statusText,
          })
        }
      } catch (error) {
        logger.error('Error loading webhook:', { error, blockId, workflowId })
      } finally {
        useSubBlockStore.setState((state) => {
          const newSet = new Set(state.loadingWebhooks)
          newSet.delete(blockId)
          return { loadingWebhooks: newSet }
        })
      }
    }

    loadWebhookOrGenerateUrl()
  }, [isPreview, triggerId, workflowId, blockId])

  const saveConfig = async (): Promise<boolean> => {
    if (isPreview || !triggerDef) {
      return false
    }

    const effectiveTriggerId = resolveEffectiveTriggerId(blockId, triggerId)

    try {
      setIsSaving(true)

      if (!webhookId) {
        const path = blockId

        const selectedCredentialId =
          (useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as string | null) ||
          null

        const triggerConfig = useSubBlockStore.getState().getValue(blockId, 'triggerConfig')

        const webhookConfig = {
          ...(triggerConfig || {}),
          ...(selectedCredentialId ? { credentialId: selectedCredentialId } : {}),
          triggerId: effectiveTriggerId,
        }

        const response = await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            blockId,
            path,
            provider: triggerDef.provider,
            providerConfig: webhookConfig,
          }),
        })

        if (!response.ok) {
          let errorMessage = 'Failed to create webhook'
          try {
            const errorData = await response.json()
            errorMessage = errorData.details || errorData.error || errorMessage
          } catch {
            // If response is not JSON, use default message
          }
          logger.error('Failed to create webhook', { errorMessage })
          throw new Error(errorMessage)
        }

        const data = await response.json()
        const savedWebhookId = data.webhook.id

        useSubBlockStore.getState().setValue(blockId, 'triggerPath', path)
        useSubBlockStore.getState().setValue(blockId, 'triggerId', effectiveTriggerId)
        useSubBlockStore.getState().setValue(blockId, 'webhookId', savedWebhookId)
        useSubBlockStore.setState((state) => ({
          checkedWebhooks: new Set([...state.checkedWebhooks, blockId]),
        }))

        logger.info('Trigger webhook created successfully', {
          webhookId: savedWebhookId,
          triggerId: effectiveTriggerId,
          provider: triggerDef.provider,
          blockId,
        })

        return true
      }

      const triggerConfig = useSubBlockStore.getState().getValue(blockId, 'triggerConfig')
      const triggerCredentials = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials')
      const selectedCredentialId = triggerCredentials as string | null

      const response = await fetch(`/api/webhooks/${webhookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerConfig: {
            ...triggerConfig,
            ...(selectedCredentialId ? { credentialId: selectedCredentialId } : {}),
            triggerId: effectiveTriggerId,
          },
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Failed to save trigger configuration'
        try {
          const errorData = await response.json()
          errorMessage = errorData.details || errorData.error || errorMessage
        } catch {
          // If response is not JSON, use default message
        }
        logger.error('Failed to save trigger config', { errorMessage })
        throw new Error(errorMessage)
      }

      logger.info('Trigger config saved successfully')
      return true
    } catch (error) {
      logger.error('Error saving trigger config:', error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const deleteConfig = async (): Promise<boolean> => {
    if (isPreview || !webhookId) {
      return false
    }

    try {
      setIsSaving(true)

      const response = await fetch(`/api/webhooks/${webhookId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        logger.error('Failed to delete webhook')
        return false
      }

      useSubBlockStore.getState().setValue(blockId, 'triggerPath', '')
      useSubBlockStore.getState().setValue(blockId, 'webhookId', null)
      useSubBlockStore.setState((state) => {
        const newSet = new Set(state.checkedWebhooks)
        newSet.delete(blockId)
        return { checkedWebhooks: newSet }
      })

      logger.info('Webhook deleted successfully')
      return true
    } catch (error) {
      logger.error('Error deleting webhook:', error)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  return {
    webhookUrl,
    webhookPath: webhookPath || blockId,
    webhookId,
    isLoading,
    isSaving,
    saveConfig,
    deleteConfig,
  }
}
