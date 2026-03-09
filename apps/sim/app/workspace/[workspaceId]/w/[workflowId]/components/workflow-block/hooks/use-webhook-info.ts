import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('useWebhookInfo')

/**
 * Return type for the useWebhookInfo hook
 */
export interface UseWebhookInfoReturn {
  /** Whether the webhook is configured with provider and path */
  isWebhookConfigured: boolean
  /** The webhook provider identifier */
  webhookProvider: string | undefined
  /** The webhook path */
  webhookPath: string | undefined
  /** Whether the webhook is disabled */
  isDisabled: boolean
  /** The webhook ID if it exists in the database */
  webhookId: string | undefined
  /** Function to reactivate a disabled webhook */
  reactivateWebhook: (webhookId: string) => Promise<void>
}

/**
 * Custom hook for managing webhook information for a block
 *
 * @param blockId - The ID of the block
 * @param workflowId - The current workflow ID
 * @returns Webhook configuration status and details
 */
export function useWebhookInfo(blockId: string, workflowId: string): UseWebhookInfoReturn {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const [webhookStatus, setWebhookStatus] = useState<{
    isDisabled: boolean
    webhookId: string | undefined
  }>({
    isDisabled: false,
    webhookId: undefined,
  })

  const isWebhookConfigured = useSubBlockStore(
    useCallback(
      (state) => {
        const blockValues = state.workflowValues[activeWorkflowId || '']?.[blockId]
        return !!(blockValues?.webhookProvider && blockValues?.webhookPath)
      },
      [activeWorkflowId, blockId]
    )
  )

  const webhookProvider = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        const value = state.workflowValues[activeWorkflowId]?.[blockId]?.webhookProvider
        if (typeof value === 'object' && value !== null && 'value' in value) {
          return (value as { value?: unknown }).value as string | undefined
        }
        return value as string | undefined
      },
      [activeWorkflowId, blockId]
    )
  )

  const webhookPath = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[blockId]?.webhookPath as string | undefined
      },
      [activeWorkflowId, blockId]
    )
  )

  const fetchWebhookStatus = useCallback(async () => {
    if (!workflowId || !blockId || !isWebhookConfigured) {
      setWebhookStatus({ isDisabled: false, webhookId: undefined })
      return
    }

    try {
      const params = new URLSearchParams({
        workflowId,
        blockId,
      })

      const response = await fetch(`/api/webhooks?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!response.ok) {
        setWebhookStatus({ isDisabled: false, webhookId: undefined })
        return
      }

      const data = await response.json()
      const webhooks = data.webhooks || []

      if (webhooks.length > 0) {
        const webhook = webhooks[0].webhook
        setWebhookStatus({
          isDisabled: !webhook.isActive,
          webhookId: webhook.id,
        })
      } else {
        setWebhookStatus({ isDisabled: false, webhookId: undefined })
      }
    } catch (error) {
      logger.error('Error fetching webhook status:', error)
      setWebhookStatus({ isDisabled: false, webhookId: undefined })
    }
  }, [workflowId, blockId, isWebhookConfigured])

  useEffect(() => {
    fetchWebhookStatus()
  }, [fetchWebhookStatus])

  const reactivateWebhook = useCallback(
    async (webhookId: string) => {
      try {
        const response = await fetch(`/api/webhooks/${webhookId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            isActive: true,
            failedCount: 0,
          }),
        })

        if (response.ok) {
          await fetchWebhookStatus()
        } else {
          logger.error('Failed to reactivate webhook')
        }
      } catch (error) {
        logger.error('Error reactivating webhook:', error)
      }
    },
    [fetchWebhookStatus]
  )

  return {
    isWebhookConfigured,
    webhookProvider,
    webhookPath,
    isDisabled: webhookStatus.isDisabled,
    webhookId: webhookStatus.webhookId,
    reactivateWebhook,
  }
}
