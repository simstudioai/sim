import { createLogger } from '@sim/logger'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  AZURE_DEVOPS_BUILD_FAILED_EVENT,
  AZURE_DEVOPS_WORK_ITEM_CREATED_EVENT,
  formatBuildCompleteInput,
  formatWebhookEnvelopeInput,
  formatWorkItemCreatedInput,
} from '@/triggers/azure_devops/utils'

const logger = createLogger('WebhookProvider:AzureDevOps')

export const azureDevOpsHandler: WebhookProviderHandler = {
  async matchEvent({
    body,
    requestId,
    providerConfig,
    webhook,
    workflow,
  }: EventMatchContext): Promise<boolean> {
    const triggerId = providerConfig.triggerId as string | undefined
    const b = body as Record<string, unknown>

    if (triggerId && triggerId !== 'azure_devops_webhook') {
      const { isAzureDevOpsEventMatch } = await import('@/triggers/azure_devops/utils')
      if (!isAzureDevOpsEventMatch(triggerId, b)) {
        logger.debug(
          `[${requestId}] Azure DevOps event mismatch for trigger ${triggerId}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            eventType: b.eventType,
          }
        )
        return false
      }
    }

    return true
  },

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown> | null
    if (!obj) return null
    const subscriptionId =
      typeof obj.subscriptionId === 'string' && obj.subscriptionId ? obj.subscriptionId : null
    const notificationId =
      typeof obj.notificationId === 'number' || typeof obj.notificationId === 'string'
        ? String(obj.notificationId)
        : null
    if (!subscriptionId || !notificationId) return null
    return `azure_devops:${subscriptionId}:${notificationId}`
  },

  async formatInput({ body, webhook, requestId }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined
    const eventType = b.eventType as string | undefined

    if (triggerId === 'azure_devops_webhook') {
      return { input: formatWebhookEnvelopeInput(b) }
    }

    if (eventType === AZURE_DEVOPS_BUILD_FAILED_EVENT) {
      return { input: formatBuildCompleteInput(b) }
    }

    if (eventType === AZURE_DEVOPS_WORK_ITEM_CREATED_EVENT) {
      return { input: formatWorkItemCreatedInput(b) }
    }

    logger.warn(`[${requestId}] Azure DevOps: unknown eventType for specialized trigger`, {
      triggerId,
      eventType,
    })
    return {
      input: null,
      skip: {
        message: `Unsupported Azure DevOps event type "${eventType ?? 'unknown'}" for trigger ${triggerId ?? 'unknown'}`,
      },
    }
  },
}
