import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useReactivateWebhook, useWebhookQuery } from '@/hooks/queries/webhooks'
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

  const { data: webhook } = useWebhookQuery(workflowId, blockId, isWebhookConfigured)
  const isDisabled = isWebhookConfigured && webhook?.isActive === false
  const webhookId = isWebhookConfigured ? webhook?.id : undefined

  const { mutateAsync: reactivateWebhookMutation } = useReactivateWebhook()
  const reactivateWebhook = useCallback(
    async (id: string) => {
      try {
        await reactivateWebhookMutation({ webhookId: id, workflowId, blockId })
      } catch (error) {
        logger.error('Error reactivating webhook:', error)
      }
    },
    [reactivateWebhookMutation, workflowId, blockId]
  )

  return {
    isWebhookConfigured,
    webhookProvider,
    webhookPath,
    isDisabled,
    webhookId,
    reactivateWebhook,
  }
}
