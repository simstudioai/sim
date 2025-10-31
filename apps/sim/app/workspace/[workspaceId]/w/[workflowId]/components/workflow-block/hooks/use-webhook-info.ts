import { useCallback } from 'react'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
}

/**
 * Custom hook for managing webhook information for a block
 *
 * @param blockId - The ID of the block
 * @returns Webhook configuration status and details
 */
export function useWebhookInfo(blockId: string): UseWebhookInfoReturn {
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
        return state.workflowValues[activeWorkflowId]?.[blockId]?.webhookProvider?.value as
          | string
          | undefined
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

  return {
    isWebhookConfigured,
    webhookProvider,
    webhookPath,
  }
}
