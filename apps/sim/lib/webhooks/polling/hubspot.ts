import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import {
  getProviderConfig,
  type PollingProviderHandler,
  type PollWebhookContext,
} from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  resolveOAuthCredential,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'

type HubSpotBuiltInObjectType = 'contact' | 'company' | 'deal' | 'ticket'
type HubSpotEventType = 'created' | 'updated'

interface HubSpotWebhookConfig {
  credentialId?: string
  /** Built-in slug, the literal 'custom' (defers to customObjectTypeId), or a raw HubSpot type id. */
  objectType?: string
  customObjectTypeId?: string
  eventType?: HubSpotEventType
  properties?: string[] | string
  filterPropertyName?: string
  filterPropertyValue?: string
  maxRecordsPerPoll?: number
  lastSeenTimestampMs?: string
  lastSeenObjectId?: string
  lastCheckedTimestamp?: string
}

interface HubSpotSearchResult {
  id: string
  properties: Record<string, string | null>
  createdAt: string
  updatedAt: string
  archived: boolean
}

interface HubSpotSearchResponse {
  total: number
  results: HubSpotSearchResult[]
  paging?: { next?: { after?: string } }
}

const HUBSPOT_PAGE_LIMIT = 100
const DEFAULT_MAX_RECORDS = 50
const MAX_MAX_RECORDS = 1000
/** HubSpot Search API: 10k result hard cap, 5 req/s rate limit. */
const MAX_PAGES_PER_POLL = 10

const BUILT_IN_PATH: Record<HubSpotBuiltInObjectType, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
}

function resolveSearchPath(objectType: string): string {
  if (objectType in BUILT_IN_PATH) {
    return BUILT_IN_PATH[objectType as HubSpotBuiltInObjectType]
  }
  return objectType
}

/** Contacts use `lastmodifieddate`; the `hs_lastmodifieddate` property is null on contacts. */
function resolveModifiedDateProperty(objectType: string): string {
  return objectType === 'contact' ? 'lastmodifieddate' : 'hs_lastmodifieddate'
}

const DEFAULT_PROPERTIES: Record<HubSpotBuiltInObjectType, string[]> = {
  contact: [
    'firstname',
    'lastname',
    'email',
    'phone',
    'company',
    'lifecyclestage',
    'hs_lead_status',
    'hubspot_owner_id',
    'createdate',
    'lastmodifieddate',
  ],
  company: [
    'name',
    'domain',
    'industry',
    'lifecyclestage',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
  deal: [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
  ticket: [
    'subject',
    'content',
    'hs_pipeline',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
}

export const hubspotPollingHandler: PollingProviderHandler = {
  provider: 'hubspot',
  label: 'HubSpot',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const accessToken = await resolveOAuthCredential(webhookData, 'hubspot', requestId, logger)
      const config = getProviderConfig<HubSpotWebhookConfig>(webhookData.providerConfig)

      const objectType = resolveObjectType(config)
      const eventType = config.eventType
      if (!objectType) {
        throw new Error(`HubSpot webhook ${webhookId} is missing objectType`)
      }
      if (eventType !== 'created' && eventType !== 'updated') {
        throw new Error(`HubSpot webhook ${webhookId} is missing or has invalid eventType`)
      }

      const filterProperty =
        eventType === 'created' ? 'createdate' : resolveModifiedDateProperty(objectType)
      const nowMs = Date.now()

      // First poll seeds the watermark to now so we don't dump pre-activation history.
      if (!config.lastSeenTimestampMs) {
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastSeenTimestampMs: String(nowMs),
            lastCheckedTimestamp: new Date(nowMs).toISOString(),
          },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] Seeded HubSpot webhook ${webhookId} watermark to ${nowMs} (${objectType}/${eventType}/${filterProperty})`
        )
        return 'success'
      }

      const watermarkMs = Number(config.lastSeenTimestampMs)
      if (!Number.isFinite(watermarkMs)) {
        throw new Error(
          `HubSpot webhook ${webhookId} has corrupt watermark ${config.lastSeenTimestampMs}`
        )
      }

      const properties = resolveRequestedProperties(config, objectType, filterProperty)
      const maxRecords = Math.min(
        Math.max(config.maxRecordsPerPoll ?? DEFAULT_MAX_RECORDS, 1),
        MAX_MAX_RECORDS
      )
      const lastSeenObjectId = config.lastSeenObjectId

      const records = await fetchHubSpotChanges({
        accessToken,
        objectType,
        filterProperty,
        watermarkMs,
        lastSeenObjectId,
        properties,
        filterPropertyName: config.filterPropertyName?.trim() || undefined,
        filterPropertyValue: config.filterPropertyValue,
        maxRecords,
        requestId,
        logger,
      })

      if (records.length === 0) {
        await updateWebhookProviderConfig(
          webhookId,
          { lastCheckedTimestamp: new Date(nowMs).toISOString() },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] No new HubSpot ${objectType} ${eventType} for webhook ${webhookId}`
        )
        return 'success'
      }

      logger.info(
        `[${requestId}] Found ${records.length} HubSpot ${objectType} ${eventType} records for webhook ${webhookId}`
      )

      const { processedCount, failedCount, highestSeenMs, maxIdAtHighestTimestamp } =
        await processRecords(
          records,
          webhookData,
          workflowData,
          objectType,
          eventType,
          filterProperty,
          requestId,
          logger
        )

      const newTimestampMs = highestSeenMs > watermarkMs ? highestSeenMs : watermarkMs
      const newObjectId = maxIdAtHighestTimestamp || lastSeenObjectId || ''

      await updateWebhookProviderConfig(
        webhookId,
        {
          lastSeenTimestampMs: String(newTimestampMs),
          lastSeenObjectId: newObjectId,
          lastCheckedTimestamp: new Date(nowMs).toISOString(),
        },
        logger
      )

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(
          `[${requestId}] All ${failedCount} HubSpot records failed to process for webhook ${webhookId}`
        )
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `[${requestId}] Processed ${processedCount} HubSpot records for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      logger.error(`[${requestId}] Error processing HubSpot webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

function resolveObjectType(config: HubSpotWebhookConfig): string {
  const raw = config.objectType?.trim()
  if (raw === 'custom') {
    return config.customObjectTypeId?.trim() ?? ''
  }
  return raw ?? ''
}

function resolveRequestedProperties(
  config: HubSpotWebhookConfig,
  objectType: string,
  filterProperty: string
): string[] {
  const requested = new Set<string>()

  const userProperties = Array.isArray(config.properties)
    ? config.properties
    : typeof config.properties === 'string'
      ? config.properties.split(/[\n,]/)
      : []

  for (const name of userProperties) {
    const trimmed = name.trim()
    if (trimmed) requested.add(trimmed)
  }

  if (requested.size === 0 && objectType in BUILT_IN_PATH) {
    for (const name of DEFAULT_PROPERTIES[objectType as HubSpotBuiltInObjectType]) {
      requested.add(name)
    }
  }

  requested.add('createdate')
  requested.add(filterProperty)
  if (config.filterPropertyName?.trim()) {
    requested.add(config.filterPropertyName.trim())
  }

  return [...requested]
}

interface FetchArgs {
  accessToken: string
  objectType: string
  filterProperty: string
  watermarkMs: number
  lastSeenObjectId?: string
  properties: string[]
  filterPropertyName?: string
  filterPropertyValue?: string
  maxRecords: number
  requestId: string
  logger: Logger
}

async function fetchHubSpotChanges(args: FetchArgs): Promise<HubSpotSearchResult[]> {
  const {
    accessToken,
    objectType,
    filterProperty,
    watermarkMs,
    lastSeenObjectId,
    properties,
    filterPropertyName,
    filterPropertyValue,
    maxRecords,
    requestId,
    logger,
  } = args

  const url = `https://api.hubapi.com/crm/v3/objects/${resolveSearchPath(objectType)}/search`
  const accumulated: HubSpotSearchResult[] = []
  let after: string | undefined
  let pages = 0

  // Two OR-combined filter groups give a strict monotonic cursor over (timestamp, id):
  //   A: filterProperty > watermark              (next timestamps)
  //   B: filterProperty == watermark AND id > lastSeenObjectId  (more ids at boundary)
  // Group B is dropped on the first poll after seeding so we don't emit boundary
  // records the seed point already skipped past.
  const userFilter =
    filterPropertyName && filterPropertyValue !== undefined && filterPropertyValue !== ''
      ? { propertyName: filterPropertyName, operator: 'EQ', value: String(filterPropertyValue) }
      : null

  const buildBody = (cursor?: string) => {
    const groups: Array<{
      filters: Array<{ propertyName: string; operator: string; value: string }>
    }> = [
      {
        filters: [
          { propertyName: filterProperty, operator: 'GT', value: String(watermarkMs) },
          ...(userFilter ? [userFilter] : []),
        ],
      },
    ]
    if (lastSeenObjectId) {
      groups.push({
        filters: [
          { propertyName: filterProperty, operator: 'EQ', value: String(watermarkMs) },
          { propertyName: 'hs_object_id', operator: 'GT', value: String(lastSeenObjectId) },
          ...(userFilter ? [userFilter] : []),
        ],
      })
    }
    return {
      filterGroups: groups,
      sorts: [{ propertyName: filterProperty, direction: 'ASCENDING' }],
      properties,
      limit: HUBSPOT_PAGE_LIMIT,
      ...(cursor ? { after: cursor } : {}),
    }
  }

  do {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildBody(after)),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      logger.error(`[${requestId}] HubSpot search API error:`, {
        status: response.status,
        objectType,
        error: errorBody,
      })
      throw new Error(`HubSpot search API ${response.status}: ${errorBody.slice(0, 500)}`)
    }

    const data = (await response.json()) as HubSpotSearchResponse
    if (data.results?.length) {
      accumulated.push(...data.results)
    }

    after = data.paging?.next?.after
    pages++

    if (accumulated.length >= maxRecords) break
    if (pages >= MAX_PAGES_PER_POLL) {
      logger.warn(
        `[${requestId}] HubSpot poll hit MAX_PAGES_PER_POLL=${MAX_PAGES_PER_POLL} — remaining records will roll over to next poll`
      )
      break
    }
  } while (after)

  // HubSpot's intra-timestamp ordering is undocumented. Sorting locally by (timestamp, id)
  // before slicing keeps the lowest-(timestamp, id) records, so any unemitted record is
  // guaranteed to match Group A or Group B on the next poll. Without this the cursor could
  // overshoot and silently skip records.
  accumulated.sort((a, b) => {
    const aTs = extractPropertyTimestampMs(a, filterProperty)
    const bTs = extractPropertyTimestampMs(b, filterProperty)
    if (aTs !== bTs) {
      if (!Number.isFinite(aTs)) return 1
      if (!Number.isFinite(bTs)) return -1
      return aTs - bTs
    }
    return compareObjectIds(a.id, b.id)
  })

  return accumulated.slice(0, maxRecords)
}

function extractPropertyTimestampMs(record: HubSpotSearchResult, propertyName: string): number {
  const raw = record.properties?.[propertyName]
  if (raw) {
    const ms = Date.parse(raw)
    if (Number.isFinite(ms)) return ms
  }
  const fallback = propertyName === 'createdate' ? record.createdAt : record.updatedAt
  return fallback ? Date.parse(fallback) : Number.NaN
}

async function processRecords(
  records: HubSpotSearchResult[],
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  objectType: string,
  eventType: HubSpotEventType,
  filterProperty: string,
  requestId: string,
  logger: Logger
): Promise<{
  processedCount: number
  failedCount: number
  highestSeenMs: number
  maxIdAtHighestTimestamp: string
}> {
  let processedCount = 0
  let failedCount = 0
  let highestSeenMs = 0
  let maxIdAtHighestTimestamp = ''

  for (const record of records) {
    const occurredAtMs = extractPropertyTimestampMs(record, filterProperty)
    if (Number.isFinite(occurredAtMs)) {
      if (occurredAtMs > highestSeenMs) {
        highestSeenMs = occurredAtMs
        maxIdAtHighestTimestamp = record.id
      } else if (occurredAtMs === highestSeenMs) {
        if (compareObjectIds(record.id, maxIdAtHighestTimestamp) > 0) {
          maxIdAtHighestTimestamp = record.id
        }
      }
    }

    try {
      await pollingIdempotency.executeWithIdempotency(
        'hubspot',
        `${webhookData.id}:${objectType}:${eventType}:${record.id}:${Number.isFinite(occurredAtMs) ? occurredAtMs : record.updatedAt}`,
        async () => {
          const payload = {
            objectType,
            eventType,
            objectId: record.id,
            occurredAt: Number.isFinite(occurredAtMs)
              ? new Date(occurredAtMs).toISOString()
              : record.updatedAt,
            properties: record.properties,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            archived: record.archived,
            timestamp: new Date().toISOString(),
          }

          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            requestId
          )

          if (!result.success) {
            throw new Error(
              `Webhook processing failed (${result.statusCode}): ${result.error ?? 'unknown'}`
            )
          }

          return { recordId: record.id, processed: true }
        }
      )

      processedCount++
    } catch (error) {
      failedCount++
      logger.error(
        `[${requestId}] Error processing HubSpot ${objectType} ${record.id}:`,
        getErrorMessage(error, 'Unknown error')
      )
    }
  }

  return {
    processedCount,
    failedCount,
    highestSeenMs,
    maxIdAtHighestTimestamp,
  }
}

/** Numeric compare for HubSpot ids (decimal strings, treated numerically by GT/LT). */
function compareObjectIds(a: string, b: string): number {
  if (!a) return b ? -1 : 0
  if (!b) return 1
  const an = Number(a)
  const bn = Number(b)
  if (Number.isFinite(an) && Number.isFinite(bn)) {
    if (an === bn) return 0
    return an > bn ? 1 : -1
  }
  if (a === b) return 0
  return a > b ? 1 : -1
}
