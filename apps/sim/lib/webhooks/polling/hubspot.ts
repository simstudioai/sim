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
type HubSpotEventType = 'created' | 'updated' | 'property_changed'

interface FilterClause {
  propertyName: string
  operator: string
  value?: string
  values?: string[]
}

interface HubSpotWebhookConfig {
  credentialId?: string
  /**
   * Built-in slug, 'custom' (defers to customObjectTypeId), 'list_membership',
   * or a raw HubSpot custom object type id ('2-12345').
   */
  objectType?: string
  customObjectTypeId?: string
  listId?: string
  eventType?: HubSpotEventType
  targetPropertyName?: string
  properties?: string[] | string
  pipelineId?: string
  stageId?: string
  ownerId?: string
  /** User-supplied AND-combined filters — string list or JSON-array string. */
  filters?: string | FilterClause[]
  maxRecordsPerPoll?: number
  lastSeenTimestampMs?: string
  lastSeenObjectId?: string
  /**
   * List-membership cursor — the `after` value to pass to the next
   * `/lists/{id}/memberships/join-order` request. The HubSpot endpoint walks
   * ASC by default (oldest first); we use cursor-based resume because
   * `before`-mode (DESC) has ambiguous bootstrap semantics.
   */
  lastSeenMembershipCursor?: string
  /**
   * True once we've walked to the end of the list once. While this is false we
   * are still in the seed pass — we paginate forward without emitting so the
   * workflow doesn't see a flood of historical members on activation.
   */
  membershipSeedComplete?: boolean
  /**
   * Snapshot of the watched property's last-seen value per record (property_changed event).
   * Persisted as an entries array (not a `Record`) because HubSpot record ids are numeric
   * strings, and JS engines enumerate integer-indexed object keys in numeric order
   * regardless of insertion — which would break LRU-style trimming. Array order is stable.
   */
  propertySnapshot?: {
    property: string
    /** `[recordId, value]` pairs in LRU order — oldest first. */
    entries: Array<[string, string | null]>
  }
  lastCheckedTimestamp?: string
}

/**
 * In-memory snapshot state used during a single poll. Uses a Map (not a plain object) so
 * insertion-order iteration is honored even for numeric-string keys.
 */
interface PropertySnapshotState {
  property: string
  values: Map<string, string | null>
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
/** Cap on property-change snapshot size to bound providerConfig payload. */
const MAX_SNAPSHOT_SIZE = 1000

const BUILT_IN_PATH: Record<HubSpotBuiltInObjectType, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
}

const VALID_OPERATORS = new Set([
  'EQ',
  'NEQ',
  'CONTAINS_TOKEN',
  'NOT_CONTAINS_TOKEN',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'BETWEEN',
  'IN',
  'NOT_IN',
  'HAS_PROPERTY',
  'NOT_HAS_PROPERTY',
])

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
    const { webhookData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const accessToken = await resolveOAuthCredential(webhookData, 'hubspot', requestId, logger)
      const config = getProviderConfig<HubSpotWebhookConfig>(webhookData.providerConfig)

      if (config.objectType === 'list_membership') {
        return await pollListMembership(ctx, config, accessToken)
      }
      return await pollSearchBased(ctx, config, accessToken)
    } catch (error) {
      logger.error(`[${requestId}] Error processing HubSpot webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function pollSearchBased(
  ctx: PollWebhookContext,
  config: HubSpotWebhookConfig,
  accessToken: string
): Promise<'success' | 'failure'> {
  const { webhookData, workflowData, requestId, logger } = ctx
  const webhookId = webhookData.id

  const objectType = resolveObjectType(config)
  const eventType = config.eventType
  if (!objectType) {
    throw new Error(`HubSpot webhook ${webhookId} is missing objectType`)
  }
  if (eventType !== 'created' && eventType !== 'updated' && eventType !== 'property_changed') {
    throw new Error(`HubSpot webhook ${webhookId} is missing or has invalid eventType`)
  }
  if (eventType === 'property_changed' && !config.targetPropertyName?.trim()) {
    throw new Error(
      `HubSpot webhook ${webhookId} uses property_changed event but has no targetPropertyName`
    )
  }

  // property_changed walks the modified-date stream and diffs the watched property locally.
  const filterProperty =
    eventType === 'created' ? 'createdate' : resolveModifiedDateProperty(objectType)
  const nowMs = Date.now()

  if (!config.lastSeenTimestampMs) {
    await updateWebhookProviderConfig(
      webhookId,
      {
        lastSeenTimestampMs: String(nowMs),
        lastCheckedTimestamp: new Date(nowMs).toISOString(),
        ...(eventType === 'property_changed'
          ? {
              propertySnapshot: {
                property: config.targetPropertyName?.trim() ?? '',
                entries: [],
              },
            }
          : {}),
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

  const userFilters = buildUserFilters(config, logger, requestId)
  const properties = resolveRequestedProperties(config, objectType, filterProperty, userFilters)
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
    userFilters,
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
    logger.info(`[${requestId}] No new HubSpot ${objectType} ${eventType} for webhook ${webhookId}`)
    return 'success'
  }

  logger.info(
    `[${requestId}] Found ${records.length} HubSpot ${objectType} ${eventType} candidates for webhook ${webhookId}`
  )

  const targetProperty = config.targetPropertyName?.trim() || undefined
  const snapshotForRun =
    eventType === 'property_changed' && targetProperty
      ? resolvePropertySnapshot(config, targetProperty)
      : null

  const { processedCount, failedCount, skippedCount, highestSeenMs, maxIdAtHighestTimestamp } =
    await processRecords(
      records,
      webhookData,
      workflowData,
      objectType,
      eventType,
      filterProperty,
      targetProperty,
      snapshotForRun,
      requestId,
      logger
    )

  const newTimestampMs = highestSeenMs > watermarkMs ? highestSeenMs : watermarkMs
  const newObjectId = maxIdAtHighestTimestamp || lastSeenObjectId || ''

  const update: Record<string, unknown> = {
    lastSeenTimestampMs: String(newTimestampMs),
    lastSeenObjectId: newObjectId,
    lastCheckedTimestamp: new Date(nowMs).toISOString(),
  }
  if (snapshotForRun) {
    update.propertySnapshot = serializeSnapshot(snapshotForRun)
  }
  await updateWebhookProviderConfig(webhookId, update, logger)

  if (failedCount > 0 && processedCount === 0) {
    await markWebhookFailed(webhookId, logger)
    logger.warn(
      `[${requestId}] All ${failedCount} HubSpot records failed to process for webhook ${webhookId}`
    )
    return 'failure'
  }

  await markWebhookSuccess(webhookId, logger)
  logger.info(
    `[${requestId}] Processed ${processedCount} HubSpot records${skippedCount ? `, skipped ${skippedCount} (no property change)` : ''}${failedCount ? `, ${failedCount} failed` : ''} for webhook ${webhookId}`
  )
  return 'success'
}

async function pollListMembership(
  ctx: PollWebhookContext,
  config: HubSpotWebhookConfig,
  accessToken: string
): Promise<'success' | 'failure'> {
  const { webhookData, workflowData, requestId, logger } = ctx
  const webhookId = webhookData.id

  const listId = config.listId?.trim()
  if (!listId) {
    throw new Error(`HubSpot list_membership trigger ${webhookId} is missing listId`)
  }
  const nowMs = Date.now()
  const seedComplete = config.membershipSeedComplete === true
  const maxRecords = Math.min(
    Math.max(config.maxRecordsPerPoll ?? DEFAULT_MAX_RECORDS, 1),
    MAX_MAX_RECORDS
  )

  // The HubSpot endpoint walks ASC by default. We resume from a stored `after` cursor —
  // empty cursor means "from the beginning of the list". During the seed pass we paginate
  // forward without emitting; once we reach the end (no `paging.next.after`) we mark the
  // seed complete and re-fetch from the cursor-to-last-page on each normal poll. New
  // members appended to the list show up on subsequent fetches; the idempotency layer
  // dedups the records we've already seen on the boundary page.
  const result = await fetchListMembershipPages({
    listId,
    accessToken,
    initialAfter: config.lastSeenMembershipCursor?.trim() || undefined,
    pageLimit: seedComplete ? maxRecords : MAX_PAGES_PER_POLL * HUBSPOT_PAGE_LIMIT,
    requestId,
    logger,
  })

  if (!seedComplete) {
    // Seed phase: don't emit. Just save the cursor and (when reached) flip the flag.
    const update: Record<string, unknown> = {
      lastCheckedTimestamp: new Date(nowMs).toISOString(),
      lastSeenMembershipCursor: result.resumeCursor ?? '',
    }
    if (result.reachedEnd) {
      update.membershipSeedComplete = true
      logger.info(
        `[${requestId}] HubSpot list_membership ${webhookId} seed complete (list=${listId})`
      )
    } else {
      logger.info(
        `[${requestId}] HubSpot list_membership ${webhookId} seed in progress (list=${listId}, scanned ${result.scanned})`
      )
    }
    await updateWebhookProviderConfig(webhookId, update, logger)
    await markWebhookSuccess(webhookId, logger)
    return 'success'
  }

  if (result.records.length === 0) {
    await updateWebhookProviderConfig(
      webhookId,
      {
        lastCheckedTimestamp: new Date(nowMs).toISOString(),
        lastSeenMembershipCursor: result.resumeCursor ?? '',
      },
      logger
    )
    await markWebhookSuccess(webhookId, logger)
    return 'success'
  }

  logger.info(
    `[${requestId}] Found ${result.records.length} HubSpot list memberships for webhook ${webhookId}`
  )

  let processedCount = 0
  let failedCount = 0

  for (const member of result.records) {
    try {
      await pollingIdempotency.executeWithIdempotency(
        'hubspot',
        `${webhookId}:list_membership:${listId}:${member.recordId}:${member.membershipTimestamp}`,
        async () => {
          const payload = {
            objectType: 'list_membership',
            eventType: 'joined',
            objectId: member.recordId,
            occurredAt: member.membershipTimestamp,
            listId,
            timestamp: new Date().toISOString(),
          }
          const wfResult = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            requestId
          )
          if (!wfResult.success) {
            throw new Error(
              `Webhook processing failed (${wfResult.statusCode}): ${wfResult.error ?? 'unknown'}`
            )
          }
          return { recordId: member.recordId, processed: true }
        }
      )
      processedCount++
    } catch (error) {
      failedCount++
      logger.error(
        `[${requestId}] Error processing HubSpot list membership ${member.recordId}:`,
        getErrorMessage(error, 'Unknown error')
      )
    }
  }

  // HubSpot's `paging.next.after` is page-granular — there's no per-record cursor we can
  // freeze on. Advance the cursor only when the entire batch succeeded; otherwise replay
  // the page next poll and let idempotency dedup the records that already landed.
  const advanceCursor = failedCount === 0
  const nextCursor = advanceCursor
    ? (result.resumeCursor ?? '')
    : (config.lastSeenMembershipCursor?.trim() ?? '')
  await updateWebhookProviderConfig(
    webhookId,
    {
      lastSeenMembershipCursor: nextCursor,
      lastCheckedTimestamp: new Date(nowMs).toISOString(),
    },
    logger
  )

  if (failedCount > 0 && processedCount === 0) {
    await markWebhookFailed(webhookId, logger)
    return 'failure'
  }

  await markWebhookSuccess(webhookId, logger)
  return 'success'
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
  filterProperty: string,
  userFilters: FilterClause[]
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
  if (config.targetPropertyName?.trim()) {
    requested.add(config.targetPropertyName.trim())
  }
  for (const f of userFilters) {
    if (f.propertyName) requested.add(f.propertyName)
  }

  return [...requested]
}

function buildUserFilters(
  config: HubSpotWebhookConfig,
  logger?: Logger,
  requestId?: string
): FilterClause[] {
  const filters: FilterClause[] = []

  // Shortcut fields translate to common HubSpot filter conditions.
  if (config.pipelineId?.trim()) {
    const property = config.objectType === 'ticket' ? 'hs_pipeline' : 'pipeline'
    filters.push({ propertyName: property, operator: 'EQ', value: config.pipelineId.trim() })
  }
  if (config.stageId?.trim()) {
    const property = config.objectType === 'ticket' ? 'hs_pipeline_stage' : 'dealstage'
    filters.push({ propertyName: property, operator: 'EQ', value: config.stageId.trim() })
  }
  if (config.ownerId?.trim()) {
    filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: config.ownerId.trim() })
  }

  const raw = config.filters
  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!entry || typeof entry !== 'object') continue
          const propertyName = String((entry as FilterClause).propertyName ?? '').trim()
          const operator = String((entry as FilterClause).operator ?? '').trim()
          if (!propertyName || !VALID_OPERATORS.has(operator)) continue
          const clause: FilterClause = { propertyName, operator }
          if (Array.isArray((entry as FilterClause).values)) {
            clause.values = (entry as FilterClause).values
          } else if ((entry as FilterClause).value !== undefined) {
            clause.value = String((entry as FilterClause).value)
          }
          filters.push(clause)
        }
      }
    } catch (error) {
      logger?.warn(
        `[${requestId ?? ''}] Could not parse user filters as JSON, ignoring:`,
        getErrorMessage(error, 'parse error')
      )
    }
  }

  return filters
}

function resolvePropertySnapshot(
  config: HubSpotWebhookConfig,
  property: string
): PropertySnapshotState {
  const existing = config.propertySnapshot
  if (existing && existing.property === property && Array.isArray(existing.entries)) {
    return { property, values: new Map(existing.entries) }
  }
  // Property changed since last config — start fresh so we don't compare against stale values.
  return { property, values: new Map() }
}

function serializeSnapshot(state: PropertySnapshotState): {
  property: string
  entries: Array<[string, string | null]>
} {
  let entries = [...state.values.entries()]
  // Drop oldest by insertion order; Map preserves it regardless of key type.
  if (entries.length > MAX_SNAPSHOT_SIZE) {
    entries = entries.slice(entries.length - MAX_SNAPSHOT_SIZE)
  }
  return { property: state.property, entries }
}

interface FetchArgs {
  accessToken: string
  objectType: string
  filterProperty: string
  watermarkMs: number
  lastSeenObjectId?: string
  properties: string[]
  userFilters: FilterClause[]
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
    userFilters,
    maxRecords,
    requestId,
    logger,
  } = args

  const url = `https://api.hubapi.com/crm/v3/objects/${encodeURIComponent(resolveSearchPath(objectType))}/search`
  const accumulated: HubSpotSearchResult[] = []
  let after: string | undefined
  let pages = 0

  // Two OR-combined filter groups give a strict monotonic cursor over (timestamp, id):
  //   A: filterProperty > watermark              (next timestamps)
  //   B: filterProperty == watermark AND id > lastSeenObjectId  (more ids at boundary)
  // User filters AND into both groups so they apply regardless of which side matches.
  // Group B is dropped on the first poll after seeding so we don't emit boundary
  // records the seed point already skipped past.
  const buildBody = (cursor?: string) => {
    const groupA: FilterClause[] = [
      { propertyName: filterProperty, operator: 'GT', value: String(watermarkMs) },
      ...userFilters,
    ]
    const groups = [{ filters: groupA }]
    if (lastSeenObjectId) {
      const groupB: FilterClause[] = [
        { propertyName: filterProperty, operator: 'EQ', value: String(watermarkMs) },
        { propertyName: 'hs_object_id', operator: 'GT', value: String(lastSeenObjectId) },
        ...userFilters,
      ]
      groups.push({ filters: groupB })
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
    if (data.results?.length) accumulated.push(...data.results)

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
  targetProperty: string | undefined,
  snapshot: PropertySnapshotState | null,
  requestId: string,
  logger: Logger
): Promise<{
  processedCount: number
  failedCount: number
  skippedCount: number
  highestSeenMs: number
  maxIdAtHighestTimestamp: string
}> {
  let processedCount = 0
  let failedCount = 0
  let skippedCount = 0
  let highestSeenMs = 0
  let maxIdAtHighestTimestamp = ''
  // Stop advancing the cursor at the first failure so that the failed record and all later
  // records (sorted ASC) get re-fetched on the next poll. Without this gate, a transient
  // failure on a record at a high timestamp would advance the cursor past it permanently.
  let cursorFrozen = false

  for (const record of records) {
    const occurredAtMs = extractPropertyTimestampMs(record, filterProperty)

    let previousValue: string | null | undefined
    let propertyValue: string | null | undefined
    let handledBySkip = false
    if (eventType === 'property_changed' && targetProperty && snapshot) {
      propertyValue = record.properties?.[targetProperty] ?? null
      const had = snapshot.values.has(record.id)
      previousValue = had ? snapshot.values.get(record.id) : undefined
      if (had && (previousValue ?? null) === (propertyValue ?? null)) {
        // Touch the snapshot so this record's entry moves to the end of the LRU order.
        // Map.delete + Map.set re-inserts at the tail, regardless of key type.
        snapshot.values.delete(record.id)
        snapshot.values.set(record.id, propertyValue ?? null)
        skippedCount++
        handledBySkip = true
      }
      // Note: we do NOT pre-update the snapshot before processing. If emission fails the
      // record must re-fetch on the next poll AND still appear as a change vs. the prior
      // snapshot — otherwise we'd silently skip it on retry.
    }

    let handledSuccessfully = handledBySkip
    if (!handledBySkip) {
      try {
        await pollingIdempotency.executeWithIdempotency(
          'hubspot',
          `${webhookData.id}:${objectType}:${eventType}:${record.id}:${Number.isFinite(occurredAtMs) ? occurredAtMs : record.updatedAt}`,
          async () => {
            const payload: Record<string, unknown> = {
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
            if (eventType === 'property_changed' && targetProperty) {
              payload.propertyName = targetProperty
              payload.propertyValue = propertyValue ?? null
              payload.previousValue = previousValue ?? null
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
        handledSuccessfully = true
        if (eventType === 'property_changed' && targetProperty && snapshot) {
          // Same delete+set dance so an updated value moves to the tail of the LRU order.
          snapshot.values.delete(record.id)
          snapshot.values.set(record.id, propertyValue ?? null)
        }
      } catch (error) {
        failedCount++
        cursorFrozen = true
        logger.error(
          `[${requestId}] Error processing HubSpot ${objectType} ${record.id}:`,
          getErrorMessage(error, 'Unknown error')
        )
      }
    }

    // Advance the cursor only for records handled (emitted or intentionally skipped) WITHOUT
    // any prior failure in this batch. Records are pre-sorted (timestamp ASC, id ASC), so
    // the watermark we persist is the highest contiguously-successful (timestamp, id) pair.
    // Anything after the first failure stays unfrozen so it gets re-fetched next poll.
    if (handledSuccessfully && !cursorFrozen && Number.isFinite(occurredAtMs)) {
      if (occurredAtMs > highestSeenMs) {
        highestSeenMs = occurredAtMs
        maxIdAtHighestTimestamp = record.id
      } else if (occurredAtMs === highestSeenMs) {
        if (compareObjectIds(record.id, maxIdAtHighestTimestamp) > 0) {
          maxIdAtHighestTimestamp = record.id
        }
      }
    }
  }

  return {
    processedCount,
    failedCount,
    skippedCount,
    highestSeenMs,
    maxIdAtHighestTimestamp,
  }
}

interface ListMembershipRecord {
  recordId: string
  membershipTimestamp: string
}

interface FetchListMembershipPagesArgs {
  listId: string
  accessToken: string
  initialAfter: string | undefined
  /** Soft cap on emitted records (normal mode) or pages × HUBSPOT_PAGE_LIMIT (seed mode). */
  pageLimit: number
  requestId: string
  logger: Logger
}

interface FetchListMembershipPagesResult {
  records: ListMembershipRecord[]
  /** Cursor to persist for the next poll; empty if we are at the very start. */
  resumeCursor: string | undefined
  /** True when the API stopped returning `paging.next.after` — we've consumed everything. */
  reachedEnd: boolean
  /** Total records scanned across pages (useful for seed-progress logging). */
  scanned: number
}

/**
 * Walks `/lists/{listId}/memberships/join-order` ASC from an optional cursor until either
 * (a) the per-poll page cap is reached or (b) the API stops returning a next cursor.
 *
 * The endpoint returns members in ascending join-order by default. We never use `before`
 * (DESC mode) because its bootstrap semantics — what value to pass for "newest first" —
 * are undocumented in HubSpot's SDK type and behave inconsistently in practice. ASC + a
 * stored cursor is provably correct and lets new members appear on subsequent polls as
 * they're appended past our cursor's position.
 */
async function fetchListMembershipPages(
  args: FetchListMembershipPagesArgs
): Promise<FetchListMembershipPagesResult> {
  const { listId, accessToken, initialAfter, pageLimit, requestId, logger } = args

  const records: ListMembershipRecord[] = []
  let after: string | undefined = initialAfter
  let pages = 0
  let reachedEnd = false
  let scanned = 0

  while (pages < MAX_PAGES_PER_POLL) {
    const params = new URLSearchParams({ limit: String(HUBSPOT_PAGE_LIMIT) })
    if (after) params.set('after', after)
    const url = `https://api.hubapi.com/crm/v3/lists/${encodeURIComponent(listId)}/memberships/join-order?${params.toString()}`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error(
        `[${requestId}] HubSpot list memberships fetch failed ${response.status}: ${errorText}`
      )
      throw new Error(
        `HubSpot list memberships fetch ${response.status}: ${errorText.slice(0, 500)}`
      )
    }

    const data = (await response.json()) as {
      results?: Array<{ recordId: string; membershipTimestamp: string }>
      paging?: { next?: { after?: string } }
    }
    const batch = data.results ?? []
    scanned += batch.length
    const nextAfter = data.paging?.next?.after

    for (const m of batch) {
      records.push({
        recordId: m.recordId,
        membershipTimestamp: m.membershipTimestamp,
      })
    }

    pages++
    if (!nextAfter) {
      reachedEnd = true
      break
    }
    after = nextAfter
    if (records.length >= pageLimit) break
  }

  return {
    records,
    // If we walked to the end, hold onto the cursor we LAST used so the next poll re-fetches
    // the tail page and picks up any members appended since. If we stopped early, the next
    // cursor walks us forward through the rest of the list.
    resumeCursor: after,
    reachedEnd,
    scanned,
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
