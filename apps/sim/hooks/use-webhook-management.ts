import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
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

    if (currentlyLoading) {
      return
    }

    if (alreadyChecked) {
      return
    }

    let isMounted = true

    const loadWebhookOrGenerateUrl = async () => {
      const currentStore = useSubBlockStore.getState()
      if (currentStore.loadingWebhooks.has(blockId)) {
        return
      }

      useSubBlockStore.setState((state) => ({
        loadingWebhooks: new Set([...state.loadingWebhooks, blockId]),
      }))

      try {
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)
        if (response.ok && isMounted) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            useSubBlockStore.getState().setValue(blockId, 'webhookId', webhook.id)

            if (webhook.path) {
              const currentPath = useSubBlockStore.getState().getValue(blockId, 'triggerPath')
              if (webhook.path !== currentPath) {
                useSubBlockStore.getState().setValue(blockId, 'triggerPath', webhook.path)
              }
            }

            if (webhook.providerConfig) {
              const currentConfig = useSubBlockStore.getState().getValue(blockId, 'triggerConfig')
              if (JSON.stringify(webhook.providerConfig) !== JSON.stringify(currentConfig)) {
                useSubBlockStore
                  .getState()
                  .setValue(blockId, 'triggerConfig', webhook.providerConfig)

                populateTriggerFieldsFromConfig(blockId, webhook.providerConfig, triggerId)
              }
            }
          } else if (isMounted) {
            useSubBlockStore.getState().setValue(blockId, 'webhookId', null)
          }

          if (isMounted) {
            useSubBlockStore.setState((state) => ({
              checkedWebhooks: new Set([...state.checkedWebhooks, blockId]),
            }))
          }
        }
      } catch (error) {
        logger.error('Error loading webhook:', { error })
      } finally {
        useSubBlockStore.setState((state) => {
          const newSet = new Set(state.loadingWebhooks)
          newSet.delete(blockId)
          return { loadingWebhooks: newSet }
        })
      }
    }

    loadWebhookOrGenerateUrl()

    return () => {
      isMounted = false
    }
  }, [isPreview, triggerId, workflowId, blockId])

  const saveConfig = async (): Promise<boolean> => {
    if (isPreview || !triggerDef) {
      return false
    }

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
          triggerId,
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
        useSubBlockStore.getState().setValue(blockId, 'triggerId', triggerId)
        useSubBlockStore.getState().setValue(blockId, 'webhookId', savedWebhookId)
        useSubBlockStore.setState((state) => ({
          checkedWebhooks: new Set([...state.checkedWebhooks, blockId]),
        }))

        logger.info('Trigger webhook created successfully', {
          webhookId: savedWebhookId,
          triggerId,
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
            triggerId,
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
