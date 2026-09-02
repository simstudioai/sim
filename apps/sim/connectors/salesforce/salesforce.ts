import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { SALESFORCE_LOGIN_HOSTS } from '@/lib/oauth/salesforce'
import { salesforceConnectorMeta } from '@/connectors/salesforce/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  htmlToPlainText,
  isListingScopeUnavailableError,
  listingRequestError,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('SalesforceConnector')

/**
 * Salesforce serves the userinfo endpoint at the org's authentication host.
 * Tokens issued at test.salesforce.com (sandbox) are rejected at login.salesforce.com,
 * so we try each host in order and cache the working one in syncContext.
 *
 * Derived from the shared connector host map so a new authorization server
 * reaches this probe automatically. The connector receives only an access
 * token — not the credential's provider id — so it cannot pick the host
 * up front the way the OAuth token route can.
 */
const USERINFO_HOSTS = Object.values(SALESFORCE_LOGIN_HOSTS).map((host) => `https://${host}`)
const USERINFO_PATH = '/services/oauth2/userinfo'

/**
 * REST API version, bare (no `v` prefix). The identity/userinfo payload returns
 * `urls.rest` as `https://host/services/data/v{version}/`, so the placeholder is
 * substituted with the bare number — prefixing it here would yield `vv62.0/`.
 */
const API_VERSION = '62.0'

/** Matches an ISO language / locale code (`en`, `en_US`). */
const LANGUAGE_CODE_REGEX = /^[a-z]{2}(_[A-Z]{2})?$/

const DEFAULT_ARTICLE_LANGUAGE = 'en_US'

/**
 * Reads the Knowledge article language from config, rejecting anything that is
 * not a plain locale code. The value is interpolated into SOQL, so validating
 * against this allowlist — rather than escaping — keeps the query injection-free.
 */
function resolveArticleLanguage(sourceConfig: Record<string, unknown>): string {
  const raw = typeof sourceConfig.articleLanguage === 'string' ? sourceConfig.articleLanguage : ''
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_ARTICLE_LANGUAGE
  if (!LANGUAGE_CODE_REGEX.test(trimmed)) {
    throw new Error(`Invalid Salesforce article language: ${trimmed}`)
  }
  return trimmed
}

/** SOQL field lists per object type. */
const OBJECT_FIELDS: Record<string, string[]> = {
  KnowledgeArticleVersion: [
    'Id',
    'Title',
    'Summary',
    'LastModifiedDate',
    'ArticleNumber',
    'PublishStatus',
  ],
  Case: ['Id', 'Subject', 'Description', 'Status', 'LastModifiedDate', 'CaseNumber'],
  Account: ['Id', 'Name', 'Description', 'Industry', 'LastModifiedDate'],
  Opportunity: [
    'Id',
    'Name',
    'Description',
    'StageName',
    'Amount',
    'LastModifiedDate',
    'CloseDate',
  ],
} as const

/**
 * SOQL WHERE clause additions per object type.
 *
 * KnowledgeArticleVersion is not freely queryable: Salesforce requires article
 * queries to "specify either the PublishStatus or the Id field in the WHERE
 * clause", so `PublishStatus='Online'` is mandatory rather than an optional
 * narrowing, and the docs further advise filtering on a single PublishStatus
 * value. `Language` is only conditionally required from API v47.0 onward
 * ("you can filter queries on Knowledge article versions with or without
 * Language depending on what you are querying"), so it is kept — pinned to one
 * user-selectable locale — rather than relying on that hedge holding for the
 * abstract KnowledgeArticleVersion view.
 */
function buildWhereClause(objectType: string, language: string, lastSyncAt?: Date): string {
  const conditions: string[] = []
  if (objectType === 'KnowledgeArticleVersion') {
    conditions.push("PublishStatus='Online'", 'IsLatestVersion=true', `Language='${language}'`)
  }
  if (lastSyncAt) conditions.push(`LastModifiedDate >= ${toSoqlDateTime(lastSyncAt)}`)
  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
}

/**
 * A SOQL dateTime literal: ISO 8601 in UTC, unquoted, and without the
 * fractional seconds SOQL does not accept.
 */
function toSoqlDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The `errorCode` values in a Salesforce REST error body (a JSON array of errors). */
function parseSalesforceErrorCodes(errorText: string): string[] {
  try {
    const parsed: unknown = JSON.parse(errorText)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { errorCode?: unknown }).errorCode === 'string'
        ? [(entry as { errorCode: string }).errorCode]
        : []
    )
  } catch {
    return []
  }
}

/**
 * Whether a failed query means the caller cannot read the configured object at
 * all. Salesforce hides an object from a user who may not read it, so the query
 * fails with 400 `INVALID_TYPE` rather than returning nothing, and an explicit
 * denial is 403 `INSUFFICIENT_ACCESS`; either is a complete listing of nothing
 * for that caller, while anything else is a fault the sync engines retry.
 */
function isSalesforceAccessDenied(status: number, errorText: string): boolean {
  if (status !== 400 && status !== 403) return false
  return parseSalesforceErrorCodes(errorText).some(
    (code) => code === 'INVALID_TYPE' || code.startsWith('INSUFFICIENT_ACCESS')
  )
}

/**
 * Result of a userinfo lookup: either the parsed payload + the auth host that
 * served it, or a structured failure describing the last response we saw.
 */
type UserinfoResult =
  | { ok: true; data: Record<string, unknown>; host: string }
  | { ok: false; status: number | undefined; errorText: string }

/**
 * Fetches the Salesforce userinfo payload, trying each candidate auth host in
 * order. Sandbox-issued tokens are rejected at login.salesforce.com with 401/403,
 * so on those statuses we fall through to test.salesforce.com. The working host
 * is cached in syncContext under `_salesforceInstanceUrl` so subsequent calls in
 * the same sync run skip the fallback dance.
 */
async function fetchUserinfo(
  accessToken: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2],
  syncContext?: Record<string, unknown>
): Promise<UserinfoResult> {
  const cachedHost =
    typeof syncContext?._salesforceInstanceUrl === 'string'
      ? (syncContext._salesforceInstanceUrl as string)
      : undefined
  const orderedHosts = cachedHost
    ? [cachedHost, ...USERINFO_HOSTS.filter((h) => h !== cachedHost)]
    : [...USERINFO_HOSTS]

  let lastStatus: number | undefined
  let lastErrorText = ''

  for (const host of orderedHosts) {
    const response = await fetchWithRetry(
      `${host}${USERINFO_PATH}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      },
      retryOptions
    )

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>
      if (syncContext) {
        syncContext._salesforceInstanceUrl = host
      }
      return { ok: true, data, host }
    }

    lastStatus = response.status
    lastErrorText = await response.text()

    // Only fall through to the next host on auth-shaped failures; surface
    // other errors (e.g. 5xx) immediately so we don't mask real problems.
    if (response.status !== 401 && response.status !== 403) {
      break
    }
  }

  return { ok: false, status: lastStatus, errorText: lastErrorText }
}

/**
 * Substitutes the `{version}` placeholder in the identity payload's `urls.rest`
 * and guarantees a single trailing slash. Salesforce documents the value as
 * `https://host/services/data/v{version}/`, so only the bare version number is
 * substituted.
 */
function normalizeRestUrl(rawRestUrl: string | undefined): string | undefined {
  if (!rawRestUrl) return undefined
  const substituted = rawRestUrl.replace('{version}', API_VERSION)
  return substituted.endsWith('/') ? substituted : `${substituted}/`
}

/** Org origin (`https://host`) for a resolved REST base URL. */
function toOrigin(restUrl: string): string {
  return new URL(restUrl).origin
}

/**
 * Resolves the Salesforce instance REST URL from the userinfo endpoint.
 * Caches the result in syncContext to avoid repeated calls.
 */
async function resolveInstanceUrl(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  if (syncContext?.instanceUrl) {
    return syncContext.instanceUrl as string
  }

  const result = await fetchUserinfo(accessToken, undefined, syncContext)
  if (!result.ok) {
    throw new Error(
      `Failed to resolve Salesforce instance URL: ${result.status ?? 'unknown'} - ${result.errorText}`
    )
  }

  const urls = result.data.urls as Record<string, string> | undefined
  const restUrl = normalizeRestUrl(urls?.rest)

  if (!restUrl) {
    throw new Error('Salesforce userinfo response did not include a REST URL')
  }

  if (syncContext) {
    syncContext.instanceUrl = restUrl
  }

  return restUrl
}

/**
 * Builds the document title for a Salesforce record based on its object type.
 */
function buildRecordTitle(objectType: string, record: Record<string, unknown>): string {
  switch (objectType) {
    case 'KnowledgeArticleVersion':
      return (record.Title as string) || 'Untitled Article'
    case 'Case':
      return (record.Subject as string) || 'Untitled Case'
    case 'Account':
      return (record.Name as string) || 'Unnamed Account'
    case 'Opportunity':
      return (record.Name as string) || 'Unnamed Opportunity'
    default:
      return `Record ${(record.Id as string) || 'Unknown'}`
  }
}

/** Fields that may contain HTML content and should be stripped to plain text. */
const HTML_FIELDS = new Set(['Description', 'Summary'])

/**
 * Builds plain-text content from a Salesforce record for indexing.
 */
function buildRecordContent(objectType: string, record: Record<string, unknown>): string {
  const parts: string[] = []
  const title = buildRecordTitle(objectType, record)
  parts.push(title)

  const fields = OBJECT_FIELDS[objectType] || []
  for (const field of fields) {
    if (field === 'Id') continue
    const value = record[field]
    if (value != null && value !== '') {
      const label = field.replace(/([A-Z])/g, ' $1').trim()
      const text =
        HTML_FIELDS.has(field) && typeof value === 'string' ? htmlToPlainText(value) : String(value)
      parts.push(`${label}: ${text}`)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Returns the record number field value based on object type.
 */
function getRecordNumber(objectType: string, record: Record<string, unknown>): string | undefined {
  switch (objectType) {
    case 'KnowledgeArticleVersion':
      return (record.ArticleNumber as string) || undefined
    case 'Case':
      return (record.CaseNumber as string) || undefined
    default:
      return undefined
  }
}

/**
 * Returns the status/stage field value based on object type.
 */
function getRecordStatus(objectType: string, record: Record<string, unknown>): string | undefined {
  switch (objectType) {
    case 'Case':
      return (record.Status as string) || undefined
    case 'Opportunity':
      return (record.StageName as string) || undefined
    default:
      return undefined
  }
}

/**
 * Creates a lightweight stub for a Salesforce record with metadata-based hash.
 * Content is deferred and fetched later via getDocument only for new/changed docs.
 */
function recordToStub(
  record: Record<string, unknown>,
  objectType: string,
  instanceUrl: string
): ExternalDocument {
  const id = record.Id as string
  const title = buildRecordTitle(objectType, record)
  const lastModified = (record.LastModifiedDate as string) || ''
  const baseUrl = toOrigin(instanceUrl)

  return {
    externalId: id,
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `${baseUrl}/${id}`,
    contentHash: `salesforce:${id}:${lastModified}`,
    metadata: {
      objectType,
      lastModified: lastModified || undefined,
      recordNumber: getRecordNumber(objectType, record),
      status: getRecordStatus(objectType, record),
    },
  }
}

/**
 * Builds a full ExternalDocument with content from a Salesforce record.
 */
function recordToDocument(
  record: Record<string, unknown>,
  objectType: string,
  instanceUrl: string
): ExternalDocument {
  const stub = recordToStub(record, objectType, instanceUrl)
  return {
    ...stub,
    content: buildRecordContent(objectType, record),
    contentDeferred: false,
  }
}

export const salesforceConnector: ConnectorConfig = {
  ...salesforceConnectorMeta,

  isListingScopeUnavailableError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const objectType = sourceConfig.objectType as string
    const maxRecords = sourceConfig.maxRecords ? Number(sourceConfig.maxRecords) : 0
    const fields = OBJECT_FIELDS[objectType]

    if (!fields) {
      throw new Error(`Unsupported Salesforce object type: ${objectType}`)
    }

    const instanceUrl = await resolveInstanceUrl(accessToken, syncContext)

    let url: string

    if (cursor) {
      url = `${toOrigin(instanceUrl)}${cursor}`
    } else {
      const whereClause = buildWhereClause(
        objectType,
        resolveArticleLanguage(sourceConfig),
        lastSyncAt
      )
      /**
       * No SOQL `LIMIT`: it bounds the total result set rather than the batch,
       * so it would end the sync after a single page. Paging is driven by
       * `nextRecordsUrl` over Salesforce's default 2,000-record query batch,
       * which is also the documented maximum, so `Sforce-Query-Options` would
       * have nothing to raise.
       */
      const soql = `SELECT ${fields.join(',')} FROM ${objectType}${whereClause} ORDER BY LastModifiedDate DESC`
      url = `${instanceUrl}query?q=${encodeURIComponent(soql)}`
    }

    logger.info(`Listing Salesforce ${objectType}`, {
      cursor: cursor || 'initial',
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Failed to query Salesforce ${objectType}`, {
        status: response.status,
        error: errorText,
      })
      throw listingRequestError(
        `Failed to query Salesforce ${objectType}`,
        response.status,
        isSalesforceAccessDenied(response.status, errorText)
      )
    }

    const data = await response.json()
    const records = (data.records || []) as Record<string, unknown>[]
    const nextRecordsUrl = data.nextRecordsUrl as string | undefined

    const documents: ExternalDocument[] = records.map((record) =>
      recordToStub(record, objectType, instanceUrl)
    )

    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let droppedByCap = false
    if (maxRecords > 0) {
      const remaining = Math.max(0, maxRecords - previouslyFetched)
      if (documents.length > remaining) {
        documents.splice(remaining)
        droppedByCap = true
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) {
      syncContext.totalDocsFetched = totalFetched
    }

    const hasMore = Boolean(nextRecordsUrl) && (maxRecords <= 0 || totalFetched < maxRecords)

    /**
     * The listing stops short of the source while records remain, so deletion
     * reconciliation must not run — it hard-deletes every stored document that
     * the capped listing omitted.
     */
    if (syncContext && (droppedByCap || (Boolean(nextRecordsUrl) && !hasMore))) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hasMore ? nextRecordsUrl : undefined,
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
    const fields = OBJECT_FIELDS[objectType]

    if (!fields) {
      throw new Error(`Unsupported Salesforce object type: ${objectType}`)
    }

    let instanceUrl = syncContext?.instanceUrl as string | undefined
    if (!instanceUrl) {
      instanceUrl = await resolveInstanceUrl(accessToken, syncContext)
    }

    const url = `${instanceUrl}sobjects/${objectType}/${encodeURIComponent(externalId)}?fields=${fields.join(',')}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Salesforce ${objectType} record: ${response.status}`)
    }

    const record = await response.json()

    if (
      objectType === 'KnowledgeArticleVersion' &&
      (record as Record<string, unknown>).PublishStatus !== 'Online'
    ) {
      return null
    }

    return recordToDocument(record, objectType, instanceUrl)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const objectType = sourceConfig.objectType as string

    if (!objectType) {
      return { valid: false, error: 'Object type is required' }
    }

    if (!OBJECT_FIELDS[objectType]) {
      return { valid: false, error: `Unsupported object type: ${objectType}` }
    }

    const maxRecords = sourceConfig.maxRecords as string | undefined
    if (maxRecords && (Number.isNaN(Number(maxRecords)) || Number(maxRecords) <= 0)) {
      return { valid: false, error: 'Max records must be a positive number' }
    }

    let language: string
    try {
      language = resolveArticleLanguage(sourceConfig)
    } catch {
      return {
        valid: false,
        error: 'Article language must be a locale code such as en_US',
      }
    }

    try {
      const userinfoResult = await fetchUserinfo(accessToken, VALIDATE_RETRY_OPTIONS)

      if (!userinfoResult.ok) {
        return {
          valid: false,
          error: `Failed to authenticate with Salesforce: ${userinfoResult.status ?? 'unknown'} - ${userinfoResult.errorText}`,
        }
      }

      const urls = userinfoResult.data.urls as Record<string, string> | undefined
      const restUrl = normalizeRestUrl(urls?.rest)

      if (!restUrl) {
        return { valid: false, error: 'Could not resolve Salesforce instance URL' }
      }

      /**
       * The object's mandatory `PublishStatus` filter has to be present here too:
       * an unfiltered `SELECT Id FROM KnowledgeArticleVersion` is rejected by
       * Salesforce, which would fail validation for a correctly configured org.
       */
      const soql = `SELECT Id FROM ${objectType}${buildWhereClause(objectType, language)} LIMIT 1`
      const queryUrl = `${restUrl}query?q=${encodeURIComponent(soql)}`

      const queryResponse = await fetchWithRetry(
        queryUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!queryResponse.ok) {
        const errorText = await queryResponse.text()
        return {
          valid: false,
          error: `Failed to access Salesforce ${objectType}: ${queryResponse.status} - ${errorText}`,
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.objectType === 'string') result.objectType = metadata.objectType

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.recordNumber === 'string') result.recordNumber = metadata.recordNumber
    if (typeof metadata.status === 'string') result.status = metadata.status

    return result
  },
}
