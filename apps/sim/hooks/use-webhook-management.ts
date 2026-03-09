import { useCallback, useEffect, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBlock } from '@/blocks'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { isTriggerValid } from '@/triggers'

const logger = createLogger('useWebhookManagement')

interface UseWebhookManagementProps {
  blockId: string
  triggerId?: string
  isPreview?: boolean
  useWebhookUrl?: boolean
}

interface WebhookManagementState {
  webhookUrl: string
  webhookPath: string
  webhookId: string | null
  isLoading: boolean
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
 * Hook to load webhook info for trigger blocks.
 * Used for displaying webhook URLs in the UI.
 * Webhook creation/updates are handled by the deploy flow.
 */
export function useWebhookManagement({
  blockId,
  triggerId,
  isPreview = false,
  useWebhookUrl = false,
}: UseWebhookManagementProps): WebhookManagementState {
  const params = useParams()
  const workflowId = params.workflowId as string

  const webhookId = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'webhookId') as string | null, [blockId])
  )
  const webhookPath = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'triggerPath') as string | null, [blockId])
  )
  const isLoading = useSubBlockStore((state) => state.loadingWebhooks.has(blockId))

  const webhookUrl = useMemo(() => {
    if (!webhookPath) {
      const baseUrl = getBaseUrl()
      return `${baseUrl}/api/webhooks/trigger/${blockId}`
    }
    const baseUrl = getBaseUrl()
    return `${baseUrl}/api/webhooks/trigger/${webhookPath}`
  }, [webhookPath, blockId])

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

    const loadWebhookInfo = async () => {
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

              const {
                credentialId: _credId,
                credentialSetId: _credSetId,
                userId: _userId,
                historyId: _historyId,
                lastCheckedTimestamp: _lastChecked,
                setupCompleted: _setupCompleted,
                externalId: _externalId,
                triggerId: _triggerId,
                blockId: _blockId,
                ...userConfigurableFields
              } = webhook.providerConfig as Record<string, unknown>

              useSubBlockStore.getState().setValue(blockId, 'triggerConfig', userConfigurableFields)

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
    if (useWebhookUrl) {
      loadWebhookInfo()
    }
  }, [isPreview, triggerId, workflowId, blockId, useWebhookUrl])

  return {
    webhookUrl,
    webhookPath: webhookPath || blockId,
    webhookId,
    isLoading,
  }
}
