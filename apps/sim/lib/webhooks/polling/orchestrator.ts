import { createLogger } from '@sim/logger'
import { generateShortId } from '@/lib/core/utils/uuid'
import { getPollingHandler } from '@/lib/webhooks/polling/registry'
import type { PollSummary, WebhookRecord, WorkflowRecord } from '@/lib/webhooks/polling/types'
import { fetchActiveWebhooks, runWithConcurrency } from '@/lib/webhooks/polling/utils'

/** Poll all active webhooks for a given provider. */
export async function pollProvider(providerName: string): Promise<PollSummary> {
  const handler = getPollingHandler(providerName)
  if (!handler) {
    throw new Error(`Unknown polling provider: ${providerName}`)
  }

  const logger = createLogger(`${handler.label}PollingService`)
  logger.info(`Starting ${handler.label} webhook polling`)

  const activeWebhooks = await fetchActiveWebhooks(handler.provider)
  if (!activeWebhooks.length) {
    logger.info(`No active ${handler.label} webhooks found`)
    return { total: 0, successful: 0, failed: 0 }
  }

  logger.info(`Found ${activeWebhooks.length} active ${handler.label} webhooks`)

  const { successCount, failureCount } = await runWithConcurrency(
    activeWebhooks,
    async (entry) => {
      const requestId = generateShortId()
      return handler.pollWebhook({
        webhookData: entry.webhook as WebhookRecord,
        workflowData: entry.workflow as WorkflowRecord,
        requestId,
        logger,
      })
    },
    logger
  )

  const summary: PollSummary = {
    total: activeWebhooks.length,
    successful: successCount,
    failed: failureCount,
  }
  logger.info(`${handler.label} polling completed`, summary)
  return summary
}
