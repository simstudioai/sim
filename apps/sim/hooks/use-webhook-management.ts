import { useEffect, useRef, useState } from 'react'
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

  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookPath, setWebhookPath] = useState('')
  const [webhookId, setWebhookId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const triggerDef = triggerId && isTriggerValid(triggerId) ? getTrigger(triggerId) : null
  const hasLoadedRef = useRef(false)
  const lastBlockIdRef = useRef<string | null>(null)
  const lastTriggerIdRef = useRef<string | undefined>(undefined)

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
      setIsLoading(false)
      return
    }

    const blockChanged = lastBlockIdRef.current !== blockId
    const triggerChanged = lastTriggerIdRef.current !== triggerId

    if (blockChanged || triggerChanged) {
      hasLoadedRef.current = false
      lastBlockIdRef.current = blockId
      lastTriggerIdRef.current = triggerId
    }

    if (hasLoadedRef.current && !blockChanged && !triggerChanged) {
      return
    }

    const loadWebhookOrGenerateUrl = async () => {
      setIsLoading(true)
      try {
        const baseUrl = getBaseUrl()
        const generatedUrl = `${baseUrl}/api/webhooks/trigger/${blockId}`
        setWebhookUrl(generatedUrl)
        setWebhookPath(blockId)

        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            setWebhookId(webhook.id)

            if (webhook.path) {
              const fullUrl = `${baseUrl}/api/webhooks/trigger/${webhook.path}`
              setWebhookUrl(fullUrl)
              setWebhookPath(webhook.path)

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
          }
        }
        hasLoadedRef.current = true
      } catch (error) {
        logger.error('Error loading webhook:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    loadWebhookOrGenerateUrl()
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
        setWebhookId(savedWebhookId)

        useSubBlockStore.getState().setValue(blockId, 'triggerPath', path)
        useSubBlockStore.getState().setValue(blockId, 'triggerId', triggerId)

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

      setWebhookId(null)
      setWebhookUrl('')
      setWebhookPath('')
      useSubBlockStore.getState().setValue(blockId, 'triggerPath', '')

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
    webhookPath,
    webhookId,
    isLoading,
    isSaving,
    saveConfig,
    deleteConfig,
  }
}
