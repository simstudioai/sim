import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { hubspotConnectorMeta } from '@/connectors/hubspot/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, looksLikeHtml, parseTagDate } from '@/connectors/utils'

const logger = createLogger('HubSpotConnector')

const BASE_URL = 'https://api.hubapi.com'

/** Max `limit` for `GET /crm/v3/objects/{objectType}` (list endpoint). */
const LIST_PAGE_SIZE = 100

/** Max `limit` for `POST /crm/v3/objects/{objectType}/search`. */
const SEARCH_PAGE_SIZE = 200

/**
 * The CRM Search API is capped at 10,000 total results per query — HubSpot
 * documents that "attempting to page beyond 10,000 will result in a 400 error".
 * No equivalent ceiling is documented for the list endpoint, so search is used
 * only when the configured record cap provably fits inside the search ceiling
 * (which buys most-recently-modified-first ordering for capped syncs); every
 * uncapped sync pages the list endpoint instead.
 */
const SEARCH_RESULT_CAP = 10_000

/** Fallback UI host when the account's `uiDomain` cannot be resolved. */
const DEFAULT_UI_DOMAIN = 'app.hubspot.com'

/** CRM object type IDs used in HubSpot record deep links (`/record/{typeId}/{id}`). */
const OBJECT_TYPE_IDS: Record<string, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
}

/** Properties to fetch per object type. */
const OBJECT_PROPERTIES: Record<string, string[]> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'phone',
    'company',
    'jobtitle',
    'lifecyclestage',
    'hs_lead_status',
    'hubspot_owner_id',
    'createdate',
    'lastmodifieddate',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'description',
    'phone',
    'city',
    'state',
    'country',
    'numberofemployees',
    'annualrevenue',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
  deals: [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
  tickets: [
    'subject',
    'content',
    'hs_pipeline',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
} as const

interface PortalInfo {
  portalId: string
  uiDomain: string
}

/**
 * Fetches the HubSpot account's portal ID and UI domain (EU portals are served
 * from `app-eu1.hubspot.com`, not `app.hubspot.com`), caching the result — and
 * any failure — in syncContext so it is fetched at most once per sync.
 *
 * Record deep links are cosmetic, so a failure here degrades to no `sourceUrl`
 * rather than aborting the whole listing.
 */
async function getPortalInfo(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<PortalInfo | null> {
  if (syncContext?.portalInfo) {
    return syncContext.portalInfo as PortalInfo
  }
  if (syncContext?.portalInfoUnavailable) {
    return null
  }

  try {
    const response = await fetchWithRetry(`${BASE_URL}/account-info/v3/details`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.warn('Failed to fetch HubSpot account details; record links will be omitted', {
        status: response.status,
        error: errorText,
      })
      if (syncContext) syncContext.portalInfoUnavailable = true
      return null
    }

    const data = (await response.json()) as { portalId?: number | string; uiDomain?: string }
    if (data.portalId === undefined || data.portalId === null) {
      if (syncContext) syncContext.portalInfoUnavailable = true
      return null
    }

    const portalInfo: PortalInfo = {
      portalId: String(data.portalId),
      uiDomain: data.uiDomain || DEFAULT_UI_DOMAIN,
    }
    if (syncContext) syncContext.portalInfo = portalInfo
    return portalInfo
  } catch (error) {
    logger.warn('Failed to fetch HubSpot account details; record links will be omitted', {
      error: getErrorMessage(error),
    })
    if (syncContext) syncContext.portalInfoUnavailable = true
    return null
  }
}

/**
 * Builds the document title for a CRM record based on its object type.
 */
function buildRecordTitle(objectType: string, properties: Record<string, string | null>): string {
  switch (objectType) {
    case 'contacts': {
      const first = properties.firstname || ''
      const last = properties.lastname || ''
      const name = `${first} ${last}`.trim()
      return name || properties.email || 'Unnamed Contact'
    }
    case 'companies':
      return properties.name || properties.domain || 'Unnamed Company'
    case 'deals':
      return properties.dealname || 'Unnamed Deal'
    case 'tickets':
      return properties.subject || 'Unnamed Ticket'
    default:
      return `Record ${properties.hs_object_id || 'Unknown'}`
  }
}

/**
 * HubSpot rich-text properties (ticket `content`, company `description`, custom
 * rich-text fields) come back as raw HTML, so they are stripped before indexing.
 *
 * The detection is deliberately the shared anchored one: CRM free text regularly
 * carries angle brackets that are not markup (`Reply from John <john@acme.com>`),
 * and a false positive here does not pass the value through — `htmlToPlainText`
 * would delete the bracketed span and collapse the value's line structure.
 */
function toPlainTextValue(value: string): string {
  return looksLikeHtml(value) ? htmlToPlainText(value) : value
}

/**
 * Builds a plain-text representation of a CRM record's properties for indexing.
 */
function buildRecordContent(objectType: string, properties: Record<string, string | null>): string {
  const parts: string[] = []

  const title = buildRecordTitle(objectType, properties)
  parts.push(title)

  for (const [key, value] of Object.entries(properties)) {
    if (value && key !== 'hs_object_id') {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      parts.push(`${label}: ${toPlainTextValue(value)}`)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Converts a HubSpot CRM record to an ExternalDocument.
 */
function recordToDocument(
  record: Record<string, unknown>,
  objectType: string,
  portal: PortalInfo | null
): ExternalDocument {
  const id = record.id as string
  const properties = (record.properties || {}) as Record<string, string | null>

  const content = buildRecordContent(objectType, properties)
  const title = buildRecordTitle(objectType, properties)

  const lastModified =
    properties.lastmodifieddate || properties.hs_lastmodifieddate || properties.createdate

  const objectTypeId = OBJECT_TYPE_IDS[objectType]
  const sourceUrl =
    portal && objectTypeId
      ? `https://${portal.uiDomain}/contacts/${portal.portalId}/record/${objectTypeId}/${id}`
      : undefined

  return {
    externalId: id,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl,
    /**
     * The `v2` namespace is a one-time invalidation. The hash is metadata-only
     * and this connector sets neither `contentDeferred` nor
     * `rehydrateOnFullSync`, so a stored record whose `lastmodifieddate` has not
     * moved can never be re-indexed — not even by a forced full resync. Without
     * the bump, existing documents would keep the raw HTML that rich-text
     * properties return, since `htmlToPlainText` is only applied on write.
     */
    contentHash: `hubspot:v2:${id}:${lastModified ?? ''}`,
    metadata: {
      objectType,
      owner: properties.hubspot_owner_id || undefined,
      lastModified: lastModified || undefined,
      pipeline: properties.pipeline || properties.hs_pipeline || undefined,
    },
  }
}

export const hubspotConnector: ConnectorConfig = {
  ...hubspotConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const objectType = sourceConfig.objectType as string
    const properties = OBJECT_PROPERTIES[objectType]
    if (!properties) {
      throw new Error(`Unsupported HubSpot object type: ${objectType}`)
    }

    const maxRecords = sourceConfig.maxRecords ? Number(sourceConfig.maxRecords) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const remaining = maxRecords > 0 ? Math.max(maxRecords - previouslyFetched, 0) : 0

    const portal = await getPortalInfo(accessToken, syncContext)

    /**
     * The search endpoint sorts by last-modified (so a capped sync keeps the most
     * recent records) but cannot page past 10,000 results. An uncapped sync — or a
     * cap larger than that ceiling — uses the list endpoint, which pages the full
     * object without a ceiling.
     */
    const useSearch = maxRecords > 0 && maxRecords <= SEARCH_RESULT_CAP
    const pageMax = useSearch ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE
    const limit = maxRecords > 0 ? Math.min(pageMax, Math.max(1, remaining)) : pageMax

    logger.info(`Listing HubSpot ${objectType}`, { cursor, useSearch, limit })

    let response: Response
    if (useSearch) {
      const sortProperty = objectType === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate'
      const searchBody: Record<string, unknown> = {
        properties,
        sorts: [{ propertyName: sortProperty, direction: 'DESCENDING' }],
        limit,
      }
      if (cursor) searchBody.after = cursor

      response = await fetchWithRetry(
        `${BASE_URL}/crm/v3/objects/${encodeURIComponent(objectType)}/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(searchBody),
        }
      )
    } else {
      const params = new URLSearchParams({
        limit: String(limit),
        properties: properties.join(','),
        archived: 'false',
      })
      if (cursor) params.set('after', cursor)

      response = await fetchWithRetry(
        `${BASE_URL}/crm/v3/objects/${encodeURIComponent(objectType)}?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Failed to list HubSpot ${objectType}`, {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list HubSpot ${objectType}: ${response.status}`)
    }

    const data = await response.json()
    const results = (data.results || []) as Record<string, unknown>[]
    const paging = data.paging as { next?: { after?: string } } | undefined
    const nextCursor = paging?.next?.after

    let documents: ExternalDocument[] = results.map((record) =>
      recordToDocument(record, objectType, portal)
    )

    if (maxRecords > 0 && documents.length > remaining) {
      documents = documents.slice(0, remaining)
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) {
      syncContext.totalDocsFetched = totalFetched
    }

    const moreAvailable = Boolean(nextCursor)
    /**
     * The search path can never reach its own 10,000-result ceiling: `useSearch`
     * only holds when `maxRecords <= SEARCH_RESULT_CAP`, so the record cap always
     * stops paging first. The cap is therefore the only stop condition here.
     */
    const hasMore = moreAvailable && !(maxRecords > 0 && totalFetched >= maxRecords)

    /**
     * Stopping while the source still has pages leaves the listing partial. The
     * sync engine hard-deletes stored documents absent from a full listing, so
     * the cap must suppress deletion reconciliation. Genuine exhaustion (no
     * `paging.next.after`) leaves the flag unset so deletions still reconcile.
     */
    if (moreAvailable && !hasMore && syncContext) {
      syncContext.listingCapped = true
      logger.warn(`HubSpot ${objectType} listing capped before source exhaustion`, {
        totalFetched,
        maxRecords,
      })
    }

    return {
      documents,
      nextCursor: hasMore ? nextCursor : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const objectType = sourceConfig.objectType as string
    const properties = OBJECT_PROPERTIES[objectType]
    if (!properties) {
      throw new Error(`Unsupported HubSpot object type: ${objectType}`)
    }

    const portal = await getPortalInfo(accessToken, syncContext)

    const params = new URLSearchParams({
      properties: properties.join(','),
      archived: 'false',
    })

    const url = `${BASE_URL}/crm/v3/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(externalId)}?${params.toString()}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get HubSpot ${objectType} record: ${response.status}`)
    }

    const record = await response.json()
    return recordToDocument(record as Record<string, unknown>, objectType, portal)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const objectType = sourceConfig.objectType as string

    if (!objectType) {
      return { valid: false, error: 'Object type is required' }
    }

    if (!OBJECT_PROPERTIES[objectType]) {
      return { valid: false, error: `Unsupported object type: ${objectType}` }
    }

    const maxRecords = sourceConfig.maxRecords as string | undefined
    if (maxRecords && (Number.isNaN(Number(maxRecords)) || Number(maxRecords) <= 0)) {
      return { valid: false, error: 'Max records must be a positive number' }
    }

    try {
      const response = await fetchWithRetry(
        `${BASE_URL}/crm/v3/objects/${encodeURIComponent(objectType)}?limit=1`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        return {
          valid: false,
          error: `Failed to access HubSpot ${objectType}: ${response.status} - ${errorText}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.objectType === 'string') result.objectType = metadata.objectType
    if (typeof metadata.owner === 'string') result.owner = metadata.owner

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.pipeline === 'string') result.pipeline = metadata.pipeline

    return result
  },
}
