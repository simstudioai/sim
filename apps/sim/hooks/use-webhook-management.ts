import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBlock } from '@/blocks'
import { useWebhookQuery } from '@/hooks/queries/webhooks'
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
 * Uses React Query for data fetching and syncs results to the sub-block store.
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
  const syncedRef = useRef(false)

  const webhookId = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'webhookId') as string | null, [blockId])
  )
  const webhookPath = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'triggerPath') as string | null, [blockId])
  )

  const webhookUrl = useMemo(() => {
    const baseUrl = getBaseUrl()
    if (!webhookPath) {
      return `${baseUrl}/api/webhooks/trigger/${blockId}`
    }
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

  const queryEnabled = useWebhookUrl && !isPreview && Boolean(workflowId && blockId)

  // Reset sync flag when blockId changes or query becomes disabled (render-phase guard)
  const prevBlockIdRef = useRef(blockId)
  if (blockId !== prevBlockIdRef.current) {
    prevBlockIdRef.current = blockId
    syncedRef.current = false
  }
  if (!queryEnabled) {
    syncedRef.current = false
  }

  const { data: webhook, isLoading: queryLoading } = useWebhookQuery(
    workflowId,
    blockId,
    queryEnabled
  )

  useEffect(() => {
    if (!queryEnabled || syncedRef.current) return
    if (webhook === undefined) return

    if (webhook) {
      syncedRef.current = true
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
      // Deliberately leave syncedRef.current = false here: when no webhook exists yet
      // (e.g., before deploy), a later refetch may return a real webhook that must be synced.
      useSubBlockStore.getState().setValue(blockId, 'webhookId', null)
    }
  }, [webhook, queryEnabled, blockId, triggerId])

  return {
    webhookUrl,
    webhookPath: webhookPath || blockId,
    webhookId,
    isLoading: queryLoading,
  }
}
