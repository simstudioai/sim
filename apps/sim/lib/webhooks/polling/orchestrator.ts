import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { findRecentlyRefusedWorkspaces } from '@/lib/webhooks/polling/admission-refusals'
import { getPollingHandler } from '@/lib/webhooks/polling/registry'
import type { PollSummary } from '@/lib/webhooks/polling/types'
import {
  fetchActiveWebhooks,
  isPollBackedOff,
  runWithConcurrency,
} from '@/lib/webhooks/polling/utils'

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
    return { total: 0, successful: 0, failed: 0, skipped: 0 }
  }

  logger.info(`Found ${activeWebhooks.length} active ${handler.label} webhooks`)

  const tickStartedAt = Date.now()
  const refusedWorkspaces = await findRecentlyRefusedWorkspaces([
    ...new Set(activeWebhooks.flatMap(({ workflow }) => workflow.workspaceId ?? [])),
  ])
  if (refusedWorkspaces.size > 0) {
    logger.info(`Skipping polls for ${refusedWorkspaces.size} workspaces refused by admission`)
  }

  const { successCount, failureCount, skippedCount } = await runWithConcurrency(
    activeWebhooks,
    async (entry) => {
      if (isPollBackedOff(entry.webhook.providerConfig, tickStartedAt)) {
        logger.debug(`Backing off webhook ${entry.webhook.id} after source fetch failures`)
        return 'skipped'
      }
      if (entry.workflow.workspaceId && refusedWorkspaces.has(entry.workflow.workspaceId)) {
        return 'skipped'
      }

      const requestId = generateShortId()
      return withResourceOutboundScope({ workspaceId: entry.workflow.workspaceId }, () =>
        handler.pollWebhook({
          webhookData: entry.webhook,
          workflowData: entry.workflow,
          requestId,
          logger,
        })
      )
    },
    logger
  )

  const summary: PollSummary = {
    total: activeWebhooks.length,
    successful: successCount,
    failed: failureCount,
    skipped: skippedCount,
  }
  logger.info(`${handler.label} polling completed`, summary)
  return summary
}
