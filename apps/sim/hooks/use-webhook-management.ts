import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'

const logger = createLogger('useWebhookManagement')

/**
 * Check if all required config fields are present
 */
function checkRequiredConfigFields(
  triggerDef: TriggerConfig,
  config: Record<string, any> | null | undefined
): boolean {
  if (!config) return false

  for (const [fieldId, fieldDef] of Object.entries(triggerDef.configFields)) {
    if (fieldDef.required) {
      const value = config[fieldId]
      if (value === undefined || value === null || value === '') {
        return false
      }
    }
  }

  return true
}

interface UseWebhookManagementProps {
  blockId: string
  triggerId?: string
  isPreview?: boolean
}

interface WebhookManagementState {
  webhookUrl: string
  webhookPath: string
  isLoading: boolean
  isSaving: boolean
}

/**
 * Hook to manage webhook lifecycle for trigger blocks
 * Handles:
 * - Auto-creating webhooks when a trigger is first configured
 * - Loading existing webhooks from the API
 * - Generating webhook URLs
 * - Auto-saving trigger configuration changes
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

  const triggerDef = triggerId ? getTrigger(triggerId) : null

  const triggerConfig = useSubBlockStore((state) => state.getValue(blockId, 'triggerConfig'))
  const triggerCredentials = useSubBlockStore((state) =>
    state.getValue(blockId, 'triggerCredentials')
  )

  useEffect(() => {
    if (triggerId && !isPreview) {
      const storedTriggerId = useSubBlockStore.getState().getValue(blockId, 'triggerId')
      if (storedTriggerId !== triggerId) {
        useSubBlockStore.getState().setValue(blockId, 'triggerId', triggerId)
      }
    }
  }, [triggerId, blockId, isPreview])

  useEffect(() => {
    // For webhook URL display, triggerId is optional (webhooks are per-block)
    // For webhook creation with required config, triggerId is needed to check config fields
    if (isPreview || isSaving) {
      setIsLoading(false)
      return
    }

    const loadOrCreateWebhook = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            setWebhookId(webhook.id)

            if (webhook.path) {
              const baseUrl = getBaseUrl()
              const fullUrl = `${baseUrl}/api/webhooks/receive/${webhook.path}`
              setWebhookUrl(fullUrl)
              setWebhookPath(webhook.path)
            }

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
              }
            }
          } else {
            // Only check required config if we have a trigger definition
            // For blocks without specific config requirements, create webhook immediately
            if (triggerDef) {
              const hasRequiredConfig = checkRequiredConfigFields(triggerDef, triggerConfig)
              if (hasRequiredConfig) {
                await createWebhook()
              }
            } else {
              // No trigger def means no required config, create webhook
              await createWebhook()
            }
          }
        }
      } catch (error) {
        logger.error('Error loading webhook:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    loadOrCreateWebhook()
  }, [isPreview, triggerId, workflowId, blockId, triggerDef, isSaving])

  const createWebhook = async () => {
    if (!triggerDef || isPreview) return

    try {
      setIsSaving(true)

      const path = triggerDef.webhook ? crypto.randomUUID() : ''

      const selectedCredentialId =
        (useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as string | null) ||
        null

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

      if (response.ok) {
        const data = await response.json()
        const savedWebhookId = data.webhook.id
        setWebhookId(savedWebhookId)
        setWebhookPath(path)

        if (path && triggerDef.webhook) {
          const baseUrl = getBaseUrl()
          const fullUrl = `${baseUrl}/api/webhooks/receive/${path}`
          setWebhookUrl(fullUrl)
        }

        useSubBlockStore.getState().setValue(blockId, 'triggerPath', path)
        useSubBlockStore.getState().setValue(blockId, 'triggerId', triggerId)

        logger.info('Trigger webhook created successfully', {
          webhookId: savedWebhookId,
          triggerId,
          provider: triggerDef.provider,
          blockId,
        })
      }
    } catch (error: any) {
      logger.error('Error creating trigger webhook:', { error })
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (isPreview || !triggerDef || !triggerConfig) return

    const saveOrCreateConfig = async () => {
      try {
        if (!webhookId) {
          const hasRequiredConfig = checkRequiredConfigFields(triggerDef, triggerConfig)
          if (hasRequiredConfig) {
            await createWebhook()
          }
          return
        }

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
          logger.error('Failed to auto-save trigger config')
        }
      } catch (error) {
        logger.error('Error auto-saving trigger config:', error)
      }
    }

    const timeoutId = setTimeout(saveOrCreateConfig, 1000)
    return () => clearTimeout(timeoutId)
  }, [triggerConfig, triggerCredentials, webhookId, triggerDef, isPreview, blockId, triggerId])

  return {
    webhookUrl,
    webhookPath,
    isLoading,
    isSaving,
  }
}
