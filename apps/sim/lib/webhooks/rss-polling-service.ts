import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import Parser from 'rss-parser'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('RssPollingService')

const MAX_CONSECUTIVE_FAILURES = 10
const MAX_GUIDS_TO_TRACK = 100 // Track recent guids to prevent duplicates

interface RssWebhookConfig {
  feedUrl: string
  lastCheckedTimestamp?: string
  lastSeenGuids?: string[]
  etag?: string
  lastModified?: string
}

interface RssItem {
  title?: string
  link?: string
  pubDate?: string
  guid?: string
  description?: string
  content?: string
  contentSnippet?: string
  author?: string
  creator?: string
  categories?: string[]
  enclosure?: {
    url: string
    type?: string
    length?: string | number
  }
  isoDate?: string
  [key: string]: any
}

interface RssFeed {
  title?: string
  link?: string
  description?: string
  items: RssItem[]
}

export interface RssWebhookPayload {
  item: RssItem
  feed: {
    title?: string
    link?: string
    description?: string
  }
  timestamp: string
}

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'SimStudio/1.0 RSS Poller',
  },
})

async function markWebhookFailed(webhookId: string) {
  try {
    const result = await db
      .update(webhook)
      .set({
        failedCount: sql`COALESCE(${webhook.failedCount}, 0) + 1`,
        lastFailedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
      .returning({ failedCount: webhook.failedCount })

    const newFailedCount = result[0]?.failedCount || 0
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

    if (shouldDisable) {
      await db
        .update(webhook)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, webhookId))

      logger.warn(
        `Webhook ${webhookId} auto-disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as failed:`, err)
  }
}

async function markWebhookSuccess(webhookId: string) {
  try {
    await db
      .update(webhook)
      .set({
        failedCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as successful:`, err)
  }
}

export async function pollRssWebhooks() {
  logger.info('Starting RSS webhook polling')

  try {
    const activeWebhooksResult = await db
      .select({ webhook })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(
        and(eq(webhook.provider, 'rss'), eq(webhook.isActive, true), eq(workflow.isDeployed, true))
      )

    const activeWebhooks = activeWebhooksResult.map((r) => r.webhook)

    if (!activeWebhooks.length) {
      logger.info('No active RSS webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active RSS webhooks`)

    const CONCURRENCY = 10
    const running: Promise<void>[] = []
    let successCount = 0
    let failureCount = 0

    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      const webhookId = webhookData.id
      const requestId = nanoid()

      try {
        const config = webhookData.providerConfig as unknown as RssWebhookConfig

        if (!config?.feedUrl) {
          logger.error(`[${requestId}] Missing feedUrl for webhook ${webhookId}`)
          await markWebhookFailed(webhookId)
          failureCount++
          return
        }

        const now = new Date()

        const { feed, items: newItems } = await fetchNewRssItems(config, requestId)

        if (!newItems.length) {
          await updateWebhookConfig(webhookId, config, now.toISOString(), [])
          await markWebhookSuccess(webhookId)
          logger.info(`[${requestId}] No new items found for webhook ${webhookId}`)
          successCount++
          return
        }

        logger.info(`[${requestId}] Found ${newItems.length} new items for webhook ${webhookId}`)

        const { processedCount, failedCount: itemFailedCount } = await processRssItems(
          newItems,
          feed,
          webhookData,
          requestId
        )

        // Collect guids from processed items
        const newGuids = newItems
          .map((item) => item.guid || item.link || '')
          .filter((guid) => guid.length > 0)

        await updateWebhookConfig(webhookId, config, now.toISOString(), newGuids)

        if (itemFailedCount > 0 && processedCount === 0) {
          await markWebhookFailed(webhookId)
          failureCount++
          logger.warn(
            `[${requestId}] All ${itemFailedCount} items failed to process for webhook ${webhookId}`
          )
        } else {
          await markWebhookSuccess(webhookId)
          successCount++
          logger.info(
            `[${requestId}] Successfully processed ${processedCount} items for webhook ${webhookId}${itemFailedCount > 0 ? ` (${itemFailedCount} failed)` : ''}`
          )
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing RSS webhook ${webhookId}:`, error)
        await markWebhookFailed(webhookId)
        failureCount++
      }
    }

    for (const webhookData of activeWebhooks) {
      const promise = enqueue(webhookData)
        .then(() => {})
        .catch((err) => {
          logger.error('Unexpected error in webhook processing:', err)
          failureCount++
        })

      running.push(promise)

      if (running.length >= CONCURRENCY) {
        const completedIdx = await Promise.race(running.map((p, i) => p.then(() => i)))
        running.splice(completedIdx, 1)
      }
    }

    await Promise.allSettled(running)

    const summary = {
      total: activeWebhooks.length,
      successful: successCount,
      failed: failureCount,
      details: [],
    }

    logger.info('RSS polling completed', {
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
    })

    return summary
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error in RSS polling service:', errorMessage)
    throw error
  }
}

async function fetchNewRssItems(
  config: RssWebhookConfig,
  requestId: string
): Promise<{ feed: RssFeed; items: RssItem[] }> {
  try {
    logger.debug(`[${requestId}] Fetching RSS feed: ${config.feedUrl}`)

    // Parse the RSS feed
    const feed = await parser.parseURL(config.feedUrl)

    if (!feed.items || !feed.items.length) {
      logger.debug(`[${requestId}] No items in feed`)
      return { feed: feed as RssFeed, items: [] }
    }

    // Filter new items based on timestamp and guids
    const lastCheckedTime = config.lastCheckedTimestamp
      ? new Date(config.lastCheckedTimestamp)
      : null
    const lastSeenGuids = new Set(config.lastSeenGuids || [])

    const newItems = feed.items.filter((item) => {
      const itemGuid = item.guid || item.link || ''

      // Check if we've already seen this item by guid
      if (itemGuid && lastSeenGuids.has(itemGuid)) {
        return false
      }

      // Check if the item is newer than our last check
      if (lastCheckedTime && item.isoDate) {
        const itemDate = new Date(item.isoDate)
        if (itemDate <= lastCheckedTime) {
          return false
        }
      }

      return true
    })

    // Sort by date, newest first
    newItems.sort((a, b) => {
      const dateA = a.isoDate ? new Date(a.isoDate).getTime() : 0
      const dateB = b.isoDate ? new Date(b.isoDate).getTime() : 0
      return dateB - dateA
    })

    // Limit to 25 items per poll to prevent overwhelming the system
    const limitedItems = newItems.slice(0, 25)

    logger.info(
      `[${requestId}] Found ${newItems.length} new items (processing ${limitedItems.length})`
    )

    return { feed: feed as RssFeed, items: limitedItems as RssItem[] }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching RSS feed:`, errorMessage)
    throw error
  }
}

async function processRssItems(
  items: RssItem[],
  feed: RssFeed,
  webhookData: any,
  requestId: string
): Promise<{ processedCount: number; failedCount: number }> {
  let processedCount = 0
  let failedCount = 0

  for (const item of items) {
    try {
      const itemGuid = item.guid || item.link || `${item.title}-${item.pubDate}`

      await pollingIdempotency.executeWithIdempotency(
        'rss',
        `${webhookData.id}:${itemGuid}`,
        async () => {
          const payload: RssWebhookPayload = {
            item: {
              title: item.title,
              link: item.link,
              pubDate: item.pubDate,
              guid: item.guid,
              description: item.description,
              content: item.content,
              contentSnippet: item.contentSnippet,
              author: item.author || item.creator,
              categories: item.categories,
              enclosure: item.enclosure,
              isoDate: item.isoDate,
            },
            feed: {
              title: feed.title,
              link: feed.link,
              description: feed.description,
            },
            timestamp: new Date().toISOString(),
          }

          const webhookUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhookData.path}`

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Secret': webhookData.secret || '',
              'User-Agent': 'SimStudio/1.0',
            },
            body: JSON.stringify(payload),
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.error(
              `[${requestId}] Failed to trigger webhook for item ${itemGuid}:`,
              response.status,
              errorText
            )
            throw new Error(`Webhook request failed: ${response.status} - ${errorText}`)
          }

          return {
            itemGuid,
            webhookStatus: response.status,
            processed: true,
          }
        }
      )

      logger.info(
        `[${requestId}] Successfully processed item ${item.title || itemGuid} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing item:`, errorMessage)
      failedCount++
    }
  }

  return { processedCount, failedCount }
}

async function updateWebhookConfig(
  webhookId: string,
  _config: RssWebhookConfig,
  timestamp: string,
  newGuids: string[]
) {
  try {
    const result = await db.select().from(webhook).where(eq(webhook.id, webhookId))
    const existingConfig = (result[0]?.providerConfig as Record<string, any>) || {}

    // Merge new guids with existing ones, keeping only the most recent
    const existingGuids = existingConfig.lastSeenGuids || []
    const allGuids = [...newGuids, ...existingGuids].slice(0, MAX_GUIDS_TO_TRACK)

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...existingConfig,
          lastCheckedTimestamp: timestamp,
          lastSeenGuids: allGuids,
        } as any,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (err) {
    logger.error(`Failed to update webhook ${webhookId} config:`, err)
  }
}
