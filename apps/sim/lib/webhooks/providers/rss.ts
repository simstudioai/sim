import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type {
  FormatInputContext,
  FormatInputResult,
  PollingConfigContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Rss')

export const rssHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    if (b && typeof b === 'object' && 'item' in b) {
      return {
        input: {
          title: b.title,
          link: b.link,
          pubDate: b.pubDate,
          item: b.item,
          feed: b.feed,
          timestamp: b.timestamp,
        },
      }
    }
    return { input: b }
  },

  async configurePolling({
    webhook: webhookData,
    requestId,
    persistProviderConfig,
  }: PollingConfigContext) {
    logger.info(`[${requestId}] Setting up RSS polling for webhook ${webhookData.id}`)

    try {
      const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
      const now = new Date()

      const configuredProviderConfig = {
        ...providerConfig,
        lastCheckedTimestamp: now.toISOString(),
        lastSeenGuids: [],
        setupCompleted: true,
      }
      if (persistProviderConfig) {
        await persistProviderConfig(configuredProviderConfig)
      } else {
        await db
          .update(webhook)
          .set({ providerConfig: configuredProviderConfig, updatedAt: now })
          .where(eq(webhook.id, webhookData.id as string))
      }

      logger.info(
        `[${requestId}] Successfully configured RSS polling for webhook ${webhookData.id}`
      )
      return true
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Failed to configure RSS polling`, {
        webhookId: webhookData.id,
        error: err.message,
      })
      return false
    }
  },
}
