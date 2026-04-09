import Parser from 'rss-parser'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { PollingProviderHandler, PollWebhookContext } from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'

const MAX_GUIDS_TO_TRACK = 500

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
  [key: string]: unknown
}

interface RssFeed {
  title?: string
  link?: string
  description?: string
  items: RssItem[]
}

export interface RssWebhookPayload {
  title?: string
  link?: string
  pubDate?: string
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
    'User-Agent': 'Sim/1.0 RSS Poller',
  },
})

export const rssPollingHandler: PollingProviderHandler = {
  provider: 'rss',
  label: 'RSS',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const config = webhookData.providerConfig as unknown as RssWebhookConfig

      if (!config?.feedUrl) {
        logger.error(`[${requestId}] Missing feedUrl for webhook ${webhookId}`)
        await markWebhookFailed(webhookId, logger)
        return 'failure'
      }

      const now = new Date()
      const {
        feed,
        items: newItems,
        etag,
        lastModified,
      } = await fetchNewRssItems(config, requestId, logger)

      if (!newItems.length) {
        await updateRssState(webhookId, now.toISOString(), [], config, logger, etag, lastModified)
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] No new items found for webhook ${webhookId}`)
        return 'success'
      }

      logger.info(`[${requestId}] Found ${newItems.length} new items for webhook ${webhookId}`)

      const { processedCount, failedCount } = await processRssItems(
        newItems,
        feed,
        webhookData,
        workflowData,
        requestId,
        logger
      )

      const newGuids = newItems
        .map(
          (item) =>
            item.guid ||
            item.link ||
            (item.title && item.pubDate ? `${item.title}-${item.pubDate}` : '')
        )
        .filter((guid) => guid.length > 0)

      await updateRssState(
        webhookId,
        now.toISOString(),
        newGuids,
        config,
        logger,
        etag,
        lastModified
      )

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(
          `[${requestId}] All ${failedCount} items failed to process for webhook ${webhookId}`
        )
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `[${requestId}] Successfully processed ${processedCount} items for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      logger.error(`[${requestId}] Error processing RSS webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function updateRssState(
  webhookId: string,
  timestamp: string,
  newGuids: string[],
  config: RssWebhookConfig,
  logger: ReturnType<typeof import('@sim/logger').createLogger>,
  etag?: string,
  lastModified?: string
) {
  const existingGuids = config.lastSeenGuids || []
  const allGuids = [...newGuids, ...existingGuids].slice(0, MAX_GUIDS_TO_TRACK)

  await updateWebhookProviderConfig(
    webhookId,
    {
      lastCheckedTimestamp: timestamp,
      lastSeenGuids: allGuids,
      ...(etag !== undefined ? { etag } : {}),
      ...(lastModified !== undefined ? { lastModified } : {}),
    },
    logger
  )
}

async function fetchNewRssItems(
  config: RssWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ feed: RssFeed; items: RssItem[]; etag?: string; lastModified?: string }> {
  try {
    const urlValidation = await validateUrlWithDNS(config.feedUrl, 'feedUrl')
    if (!urlValidation.isValid) {
      logger.error(`[${requestId}] Invalid RSS feed URL: ${urlValidation.error}`)
      throw new Error(`Invalid RSS feed URL: ${urlValidation.error}`)
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Sim/1.0 RSS Poller',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    }
    if (config.etag) {
      headers['If-None-Match'] = config.etag
    }
    if (config.lastModified) {
      headers['If-Modified-Since'] = config.lastModified
    }

    const response = await secureFetchWithPinnedIP(config.feedUrl, urlValidation.resolvedIP!, {
      headers,
      timeout: 30000,
    })

    if (response.status === 304) {
      logger.info(`[${requestId}] RSS feed not modified (304) for ${config.feedUrl}`)
      return {
        feed: { items: [] } as RssFeed,
        items: [],
        etag: response.headers.get('etag') ?? config.etag,
        lastModified: response.headers.get('last-modified') ?? config.lastModified,
      }
    }

    if (!response.ok) {
      await response.text().catch(() => {})
      throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`)
    }

    const newEtag = response.headers.get('etag') ?? undefined
    const newLastModified = response.headers.get('last-modified') ?? undefined

    const xmlContent = await response.text()
    const feed = await parser.parseString(xmlContent)

    if (!feed.items || !feed.items.length) {
      return { feed: feed as RssFeed, items: [], etag: newEtag, lastModified: newLastModified }
    }

    const lastCheckedTime = config.lastCheckedTimestamp
      ? new Date(config.lastCheckedTimestamp)
      : null
    const lastSeenGuids = new Set(config.lastSeenGuids || [])

    const newItems = feed.items.filter((item) => {
      const itemGuid =
        item.guid ||
        item.link ||
        (item.title && item.pubDate ? `${item.title}-${item.pubDate}` : '')

      if (itemGuid && lastSeenGuids.has(itemGuid)) {
        return false
      }

      if (lastCheckedTime && item.isoDate) {
        const itemDate = new Date(item.isoDate)
        if (itemDate <= lastCheckedTime) {
          return false
        }
      }

      return true
    })

    newItems.sort((a, b) => {
      const dateA = a.isoDate ? new Date(a.isoDate).getTime() : 0
      const dateB = b.isoDate ? new Date(b.isoDate).getTime() : 0
      return dateB - dateA
    })

    const limitedItems = newItems.slice(0, 25)

    logger.info(
      `[${requestId}] Found ${newItems.length} new items (processing ${limitedItems.length})`
    )

    return {
      feed: feed as RssFeed,
      items: limitedItems as RssItem[],
      etag: newEtag,
      lastModified: newLastModified,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching RSS feed:`, errorMessage)
    throw error
  }
}

async function processRssItems(
  items: RssItem[],
  feed: RssFeed,
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ processedCount: number; failedCount: number }> {
  let processedCount = 0
  let failedCount = 0

  for (const item of items) {
    try {
      const itemGuid =
        item.guid ||
        item.link ||
        (item.title && item.pubDate ? `${item.title}-${item.pubDate}` : '')

      if (!itemGuid) {
        logger.warn(
          `[${requestId}] Skipping RSS item with no identifiable GUID for webhook ${webhookData.id}`
        )
        continue
      }

      await pollingIdempotency.executeWithIdempotency(
        'rss',
        `${webhookData.id}:${itemGuid}`,
        async () => {
          const payload: RssWebhookPayload = {
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
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

          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            requestId
          )

          if (!result.success) {
            logger.error(
              `[${requestId}] Failed to process webhook for item ${itemGuid}:`,
              result.statusCode,
              result.error
            )
            throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
          }

          return { itemGuid, processed: true }
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
