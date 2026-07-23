import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { validateServiceNowInstanceUrl } from '@/lib/core/security/input-validation'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_ITEMS, servicenowConnectorMeta } from '@/connectors/servicenow/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('ServiceNowConnector')

const PAGE_SIZE = 100

/**
 * ServiceNow sys_id whitelist: 32-character lowercase hex strings.
 *
 * The encoded query language uses `^` as the AND separator and `^OR` as the
 * OR separator with no escape syntax, so any user-supplied value interpolated
 * into a `sysparm_query` clause must be validated up front. Path-based
 * fetches (`/api/now/table/{table}/{sys_id}`) likewise treat the sys_id as a
 * URL path segment and must be constrained to safe characters.
 */
const SYS_ID_PATTERN = /^[a-f0-9]{32}$/i
const NUMERIC_ID_PATTERN = /^\d+$/
/**
 * Reject characters that have meaning in a ServiceNow encoded query
 * (`^` is the operator separator; control chars and quotes can break the
 * URL). All other Unicode characters — including accented letters used in
 * categories like "Général" or "Ação" — are allowed.
 */
const KB_CATEGORY_DISALLOWED = /[\^"'`\u0000-\u001f\u007f]/
const VALID_WORKFLOW_STATES = new Set(['published', 'draft', 'review', 'retired', 'outdated'])

/**
 * The single KB workflow state that means "removed from view".
 *
 * `retired` is the documented end of a knowledge article's lifecycle: the row is
 * never deleted from `kb_knowledge`, it just stops appearing in knowledge search
 * and portal views. It is therefore the only state safe to drop implicitly.
 *
 * `outdated` is deliberately NOT in this set. It marks a superseded version when
 * a new version is published, but ServiceNow also moves an article to `outdated`
 * once it passes its `valid_to` date — and that record is still the latest
 * version of the article, not a historical snapshot. Excluding `outdated` would
 * therefore make deletion reconciliation hard-delete live customer content.
 */
const REMOVED_FROM_VIEW_KB_WORKFLOW_STATE = 'retired'

/**
 * Decides whether a `kb_knowledge` record should be ingested.
 *
 * `GET /api/now/table/kb_knowledge` applies no implicit state filter, so retired
 * articles keep appearing in every full listing, keep getting upserted, and
 * never fall out via deletion reconciliation (which removes only documents
 * absent from the listing). This guard drops them.
 *
 * The implicit exclusion applies ONLY when the connector config leaves
 * `workflowState` unset. Any explicit selection — including `all` ("All States")
 * and `retired` itself — is the user's stated intent and is honoured verbatim,
 * with no client-side filtering layered on top of the server-side
 * `sysparm_query` clause built by {@link buildKBQuery}.
 *
 * Fail-open by design: only an EXPLICIT `retired` state excludes a record. A
 * missing, empty, non-string or unrecognised state (`pending retirement`, a
 * customer-defined state) is kept, because a wrongful exclusion would make
 * reconciliation hard-delete a still-current article. For the same reason the
 * exclusion is applied client-side rather than as an encoded-query `!=` clause:
 * ServiceNow's negative operators have inconsistently reported behaviour for
 * empty field values, and a server-side filter that silently dropped rows with
 * no `workflow_state` would purge them.
 *
 * Known and accepted consequence: no `latest=true` filter is applied, so when an
 * instance runs the knowledge versioning plugin, superseded versions are still
 * ingested as separate documents (each prior version is its own `kb_knowledge`
 * row with its own sys_id). Filtering on `latest` is not safe generally —
 * instances without versioning enabled do not populate the field reliably, and a
 * missing/false value there would purge current articles.
 */
export function shouldIngestKBArticle(
  article: Record<string, unknown>,
  configuredWorkflowState?: unknown
): boolean {
  if (typeof configuredWorkflowState === 'string' && configuredWorkflowState.trim()) {
    return true
  }

  const state = rawValue(article.workflow_state)?.trim().toLowerCase()
  if (!state) return true
  return state !== REMOVED_FROM_VIEW_KB_WORKFLOW_STATE
}

/**
 * The object form a field takes under `sysparm_display_value=all`.
 *
 * Under `all` the Table API wraps EVERY column — not just reference and choice
 * fields, and explicitly including `sys_id` — in `{ display_value, value }`.
 * Reference fields carry an additional `link`, and `display_value` is `null`
 * rather than `""` when the field is empty.
 */
interface ServiceNowFieldObject {
  value?: string
  display_value?: string | null
  link?: string
}

/**
 * A field as it may arrive from the Table API.
 *
 * Both shapes must be tolerated: this connector requests
 * `sysparm_display_value=all` (object form), but plain strings are what the
 * same endpoint returns under `true`/`false`, and are still what a record
 * fetched without the parameter looks like. Every read therefore goes through
 * {@link rawValue} or {@link displayValue}, never through a direct field access.
 */
type ServiceNowField = string | ServiceNowFieldObject | null | undefined

interface ServiceNowRecord {
  sys_id: ServiceNowField
  sys_updated_on?: ServiceNowField
  sys_created_on?: ServiceNowField
  sys_created_by?: ServiceNowField
  sys_updated_by?: ServiceNowField
}

interface KBArticle extends ServiceNowRecord {
  short_description?: ServiceNowField
  text?: ServiceNowField
  wiki?: ServiceNowField
  workflow_state?: ServiceNowField
  kb_category?: ServiceNowField
  kb_knowledge_base?: ServiceNowField
  number?: ServiceNowField
  author?: ServiceNowField
}

interface Incident extends ServiceNowRecord {
  number?: ServiceNowField
  short_description?: ServiceNowField
  description?: ServiceNowField
  state?: ServiceNowField
  priority?: ServiceNowField
  category?: ServiceNowField
  assigned_to?: ServiceNowField
  opened_by?: ServiceNowField
  close_notes?: ServiceNowField
  comments_and_work_notes?: ServiceNowField
  work_notes?: ServiceNowField
  resolution_notes?: ServiceNowField
}

/**
 * Normalizes and validates the ServiceNow instance URL.
 *
 * Prepends https:// if the scheme is missing, strips trailing slashes, then
 * enforces a ServiceNow-owned domain allowlist to prevent SSRF — the instance
 * URL is user-controlled and was previously fetched server-side with no
 * validation.
 */
function resolveServiceNowInstanceUrl(rawUrl: string): string {
  let url = (rawUrl ?? '').trim().replace(/\/+$/, '')
  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    url = `https://${url}`
  }
  const validation = validateServiceNowInstanceUrl(url)
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid instance URL')
  }
  return validation.sanitized ?? url
}

/**
 * Builds Basic Auth header from username and API key/password.
 */
function buildAuthHeader(accessToken: string, sourceConfig: Record<string, unknown>): string {
  const username = sourceConfig.username as string
  const encoded = Buffer.from(`${username}:${accessToken}`).toString('base64')
  return `Basic ${encoded}`
}

/**
 * Calls the ServiceNow Table API.
 */
async function serviceNowApiGet(
  instanceUrl: string,
  tableName: string,
  authHeader: string,
  params: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<{ result: Record<string, unknown>[]; nextOffset?: number; totalCount?: number }> {
  const queryParams = new URLSearchParams(params)
  const url = `${instanceUrl}/api/now/table/${tableName}?${queryParams.toString()}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ServiceNow API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as { result: Record<string, unknown>[] }

  const totalCountHeader = response.headers.get('X-Total-Count')
  const totalCount = totalCountHeader ? Number(totalCountHeader) : undefined

  const offset = Number(params.sysparm_offset || '0')
  const limit = Number(params.sysparm_limit || String(PAGE_SIZE))
  const resultCount = data.result?.length ?? 0

  const nextOffset = resultCount >= limit ? offset + limit : undefined

  return {
    result: data.result || [],
    nextOffset,
    totalCount,
  }
}

/**
 * Fetches a single ServiceNow record by sys_id via the path-based Table API
 * endpoint (`GET /api/now/table/{tableName}/{sys_id}`), which returns a
 * `{ result: <record> }` object rather than the array shape returned by the
 * list endpoint. Returns `null` when the record is not found (404).
 */
async function serviceNowApiGetById(
  instanceUrl: string,
  tableName: string,
  sysId: string,
  authHeader: string,
  params: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown> | null> {
  const queryParams = new URLSearchParams(params)
  const queryString = queryParams.toString()
  const url = `${instanceUrl}/api/now/table/${tableName}/${sysId}${queryString ? `?${queryString}` : ''}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
    retryOptions
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ServiceNow API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as { result?: Record<string, unknown> }
  return data.result ?? null
}

/**
 * Accepts a record that carries a usable sys_id in either wire shape.
 *
 * Both listing and single-record fetches send `sysparm_display_value=all`, under
 * which `sys_id` arrives as `{ display_value, value }` rather than as a plain
 * string, so a `typeof === 'string'` test would reject every record. Normalising
 * through {@link rawValue} accepts the object form and still accepts the plain
 * string form returned when the parameter is absent or set to `true`/`false`.
 * `rawValue` returns `undefined` for an empty string, so a non-empty result is
 * exactly the original intent: reject records with no usable sys_id.
 */
function isServiceNowRecord(record: unknown): record is ServiceNowRecord & Record<string, unknown> {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return false
  }
  return Boolean(rawValue((record as Record<string, unknown>).sys_id))
}

/**
 * Extracts a display value from a field that may be a string or a reference object.
 * When sysparm_display_value=true, fields are plain strings.
 * When sysparm_display_value=all, fields are objects with display_value/value.
 * This helper normalises both shapes.
 */
function displayValue(field: unknown): string | undefined {
  if (typeof field === 'string') return field || undefined
  if (field && typeof field === 'object') {
    const obj = field as Record<string, unknown>
    if ('display_value' in obj && typeof obj.display_value === 'string') {
      return obj.display_value || undefined
    }
    if ('value' in obj && typeof obj.value === 'string') {
      return obj.value || undefined
    }
  }
  return undefined
}

/**
 * Extracts the raw value from a field that may be a string or an object
 * returned by sysparm_display_value=all. Prefers `value` over `display_value`
 * so that coded values (e.g. state "1") are preserved for mapping functions.
 */
function rawValue(field: unknown): string | undefined {
  if (typeof field === 'string') return field || undefined
  if (field && typeof field === 'object') {
    const obj = field as Record<string, unknown>
    if ('value' in obj && typeof obj.value === 'string') {
      return obj.value || undefined
    }
    if ('display_value' in obj && typeof obj.display_value === 'string') {
      return obj.display_value || undefined
    }
  }
  return undefined
}

/**
 * Maps ServiceNow state codes to human-readable labels for incidents.
 */
function incidentStateLabel(state: string | undefined): string {
  const stateMap: Record<string, string> = {
    '1': 'New',
    '2': 'In Progress',
    '3': 'On Hold',
    '6': 'Resolved',
    '7': 'Closed',
    '8': 'Canceled',
  }
  return state ? stateMap[state] || state : 'Unknown'
}

/**
 * Maps ServiceNow priority codes to human-readable labels.
 */
function priorityLabel(priority: string | undefined): string {
  const priorityMap: Record<string, string> = {
    '1': 'Critical',
    '2': 'High',
    '3': 'Moderate',
    '4': 'Low',
    '5': 'Planning',
  }
  return priority ? priorityMap[priority] || priority : 'Unknown'
}

/**
 * Converts a KB article record to an ExternalDocument.
 */
function kbArticleToDocument(article: KBArticle, instanceUrl: string): ExternalDocument {
  const sysId = rawValue(article.sys_id) ?? ''
  const title = rawValue(article.short_description) || rawValue(article.number) || sysId
  /**
   * Wiki-template KB articles populate `wiki` with the body and leave
   * `text` empty; HTML-template articles do the opposite. Falling back
   * to `wiki` keeps both layouts indexable.
   */
  const articleText = rawValue(article.text) || rawValue(article.wiki) || ''
  const content = htmlToPlainText(articleText)
  const updatedOn = rawValue(article.sys_updated_on) || ''
  const contentHash = `servicenow:${sysId}:${updatedOn}`
  const sourceUrl = `${instanceUrl}/kb_view.do?sys_kb_id=${sysId}`

  return {
    externalId: sysId,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash,
    metadata: {
      type: 'kb_article',
      number: rawValue(article.number),
      workflowState: rawValue(article.workflow_state),
      category: displayValue(article.kb_category),
      knowledgeBase: displayValue(article.kb_knowledge_base),
      author: displayValue(article.author) || rawValue(article.sys_created_by),
      lastUpdated: rawValue(article.sys_updated_on),
      createdOn: rawValue(article.sys_created_on),
    },
  }
}

/**
 * Converts an incident record to an ExternalDocument.
 */
function incidentToDocument(incident: Incident, instanceUrl: string): ExternalDocument {
  const sysId = rawValue(incident.sys_id) ?? ''
  const number = rawValue(incident.number)
  const shortDesc = rawValue(incident.short_description)
  const title = number ? `${number}: ${shortDesc || 'Untitled'}` : shortDesc || sysId

  const parts: string[] = []
  if (shortDesc) {
    parts.push(`Summary: ${shortDesc}`)
  }
  const description = rawValue(incident.description)
  if (description) {
    parts.push(`Description: ${htmlToPlainText(description)}`)
  }
  const state = rawValue(incident.state)
  const priority = rawValue(incident.priority)
  parts.push(`State: ${incidentStateLabel(state)}`)
  parts.push(`Priority: ${priorityLabel(priority)}`)
  const category = rawValue(incident.category)
  if (category) {
    parts.push(`Category: ${category}`)
  }
  if (displayValue(incident.assigned_to)) {
    parts.push(`Assigned To: ${displayValue(incident.assigned_to)}`)
  }
  if (displayValue(incident.opened_by)) {
    parts.push(`Opened By: ${displayValue(incident.opened_by)}`)
  }
  const resolutionNotes = rawValue(incident.resolution_notes)
  if (resolutionNotes) {
    parts.push(`Resolution Notes: ${htmlToPlainText(resolutionNotes)}`)
  }
  const closeNotes = rawValue(incident.close_notes)
  if (closeNotes) {
    parts.push(`Close Notes: ${htmlToPlainText(closeNotes)}`)
  }

  const content = parts.join('\n')
  const updatedOn = rawValue(incident.sys_updated_on) || ''
  const contentHash = `servicenow:${sysId}:${updatedOn}`
  const sourceUrl = `${instanceUrl}/incident.do?sys_id=${sysId}`

  return {
    externalId: sysId,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash,
    metadata: {
      type: 'incident',
      number,
      state: incidentStateLabel(state),
      priority: priorityLabel(priority),
      category,
      assignedTo: displayValue(incident.assigned_to),
      openedBy: displayValue(incident.opened_by),
      author: displayValue(incident.opened_by) || rawValue(incident.sys_created_by),
      lastUpdated: rawValue(incident.sys_updated_on),
      createdOn: rawValue(incident.sys_created_on),
    },
  }
}

/**
 * Builds the sysparm_query filter string for KB articles.
 */
function buildKBQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = []

  const workflowState = sourceConfig.workflowState as string | undefined
  if (workflowState && workflowState !== 'all') {
    if (VALID_WORKFLOW_STATES.has(workflowState)) {
      parts.push(`workflow_state=${workflowState}`)
    } else {
      logger.warn('Skipping workflowState filter: value is not in the allowed set', {
        workflowState,
      })
    }
  }

  const kbCategory = sourceConfig.kbCategory as string | undefined
  const trimmedCategory = kbCategory?.trim()
  if (trimmedCategory) {
    if (!KB_CATEGORY_DISALLOWED.test(trimmedCategory)) {
      parts.push(`kb_category.label=${trimmedCategory}`)
    } else {
      logger.warn('Skipping kbCategory filter: value contains disallowed characters', {
        kbCategory: trimmedCategory,
      })
    }
  }

  parts.push('ORDERBYDESCsys_updated_on')
  return parts.join('^')
}

/**
 * Builds the sysparm_query filter string for incidents.
 */
function buildIncidentQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = []

  const incidentState = sourceConfig.incidentState as string | undefined
  if (incidentState && incidentState !== 'all') {
    if (NUMERIC_ID_PATTERN.test(incidentState)) {
      parts.push(`state=${incidentState}`)
    } else {
      logger.warn('Skipping incidentState filter: value is not a numeric ID', { incidentState })
    }
  }

  const incidentPriority = sourceConfig.incidentPriority as string | undefined
  if (incidentPriority && incidentPriority !== 'all') {
    if (NUMERIC_ID_PATTERN.test(incidentPriority)) {
      parts.push(`priority=${incidentPriority}`)
    } else {
      logger.warn('Skipping incidentPriority filter: value is not a numeric ID', {
        incidentPriority,
      })
    }
  }

  parts.push('ORDERBYDESCsys_updated_on')
  return parts.join('^')
}

export const servicenowConnector: ConnectorConfig = {
  ...servicenowConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const instanceUrl = resolveServiceNowInstanceUrl(sourceConfig.instanceUrl as string)
    const contentType = (sourceConfig.contentType as string) || 'kb_knowledge'
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : DEFAULT_MAX_ITEMS
    const authHeader = buildAuthHeader(accessToken, sourceConfig)

    const offset = cursor ? Number(cursor) : 0
    const remaining = maxItems - offset
    if (remaining <= 0) {
      /**
       * The `maxItems` cap stopped this listing before the table was exhausted,
       * so it does not represent the full source set. Flagging it keeps the sync
       * engine's deletion reconciliation from reading the missing tail as
       * "deleted at the source" and hard-deleting those documents.
       */
      if (syncContext) syncContext.listingCapped = true
      return { documents: [], hasMore: false }
    }

    const limit = Math.min(PAGE_SIZE, remaining)
    const isKB = contentType === 'kb_knowledge'
    const tableName = isKB ? 'kb_knowledge' : 'incident'
    const query = isKB ? buildKBQuery(sourceConfig) : buildIncidentQuery(sourceConfig)

    const fields = isKB
      ? 'sys_id,short_description,text,wiki,workflow_state,kb_category,kb_knowledge_base,number,author,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'
      : 'sys_id,number,short_description,description,state,priority,category,assigned_to,opened_by,close_notes,resolution_notes,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'

    const params: Record<string, string> = {
      sysparm_limit: String(limit),
      sysparm_offset: String(offset),
      sysparm_query: query,
      sysparm_fields: fields,
      sysparm_display_value: 'all',
    }

    logger.info('Fetching ServiceNow records', {
      table: tableName,
      offset,
      limit,
      query,
    })

    const { result, nextOffset, totalCount } = await serviceNowApiGet(
      instanceUrl,
      tableName,
      authHeader,
      params
    )

    const documents: ExternalDocument[] = []
    for (const record of result) {
      if (!isServiceNowRecord(record)) {
        logger.warn('Skipping ServiceNow record without sys_id', { table: tableName })
        continue
      }

      /**
       * Retired articles are dropped here, not via the encoded query, so records
       * with no `workflow_state` are never lost to ServiceNow's
       * negative-operator semantics. Paging stays derived from the API result
       * count (see `serviceNowApiGet`), never from the post-filter document
       * count, so filtering never shifts the offset window.
       */
      if (isKB && !shouldIngestKBArticle(record, sourceConfig.workflowState)) {
        continue
      }

      const doc = isKB
        ? kbArticleToDocument(record, instanceUrl)
        : incidentToDocument(record, instanceUrl)

      if (doc.content.trim()) {
        documents.push(doc)
      }
    }

    const hasMore = nextOffset !== undefined && nextOffset < maxItems
    const nextCursor = hasMore ? String(nextOffset) : undefined

    /**
     * Records exist past the `maxItems` cap. See the `remaining <= 0` branch
     * above — the listing is knowingly incomplete, so reconciliation must not
     * treat the untraversed tail as removed at the source.
     *
     * A full page landing exactly on the cap is ambiguous: `nextOffset` is set
     * whenever a page comes back full, so it cannot distinguish "more rows
     * follow" from "the table ended on a page boundary". `X-Total-Count`
     * resolves it when present; when the header is absent the ambiguity is
     * resolved conservatively (assume truncated), since over-flagging only
     * defers a purge whereas under-flagging deletes live documents.
     */
    if (nextOffset !== undefined && !hasMore && syncContext) {
      if (totalCount === undefined || totalCount > maxItems) {
        syncContext.listingCapped = true
      }
    }

    logger.info('Fetched ServiceNow documents', {
      count: documents.length,
      hasMore,
      nextCursor,
    })

    return {
      documents,
      nextCursor,
      hasMore,
    }
  },

  /**
   * Fetches one record by sys_id.
   *
   * No `workflow_state` guard is applied here on purpose. The sync engine calls
   * this only to hydrate content for documents that `listDocuments` already
   * admitted (and only for `contentDeferred` entries, which this connector never
   * emits), so a second filter would be unreachable today and, if it ever became
   * reachable, could only turn an already-selected document into a skip.
   */
  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const contentType = (sourceConfig.contentType as string) || 'kb_knowledge'
    const authHeader = buildAuthHeader(accessToken, sourceConfig)
    const isKB = contentType === 'kb_knowledge'
    const tableName = isKB ? 'kb_knowledge' : 'incident'

    if (!SYS_ID_PATTERN.test(externalId)) {
      logger.warn('Rejecting ServiceNow getDocument with invalid sys_id', {
        externalId,
        table: tableName,
      })
      return null
    }

    const fields = isKB
      ? 'sys_id,short_description,text,wiki,workflow_state,kb_category,kb_knowledge_base,number,author,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'
      : 'sys_id,number,short_description,description,state,priority,category,assigned_to,opened_by,close_notes,resolution_notes,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'

    const instanceUrl = resolveServiceNowInstanceUrl(sourceConfig.instanceUrl as string)

    try {
      const record = await serviceNowApiGetById(instanceUrl, tableName, externalId, authHeader, {
        sysparm_fields: fields,
        sysparm_display_value: 'all',
      })

      if (!record || !isServiceNowRecord(record)) {
        return null
      }

      const doc = isKB
        ? kbArticleToDocument(record, instanceUrl)
        : incidentToDocument(record, instanceUrl)

      return doc.content.trim() ? doc : null
    } catch (error) {
      logger.warn('Failed to get ServiceNow document', {
        externalId,
        table: tableName,
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const instanceUrl = sourceConfig.instanceUrl as string | undefined
    const username = sourceConfig.username as string | undefined
    const contentType = sourceConfig.contentType as string | undefined
    const maxItems = sourceConfig.maxItems as string | undefined

    if (!instanceUrl?.trim()) {
      return { valid: false, error: 'Instance URL is required' }
    }

    if (!username?.trim()) {
      return { valid: false, error: 'Username is required' }
    }

    if (!contentType) {
      return { valid: false, error: 'Content type is required' }
    }

    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    let normalizedUrl: string
    try {
      normalizedUrl = resolveServiceNowInstanceUrl(instanceUrl)
    } catch (error) {
      return { valid: false, error: toError(error).message }
    }

    const authHeader = buildAuthHeader(accessToken, sourceConfig)
    const tableName = contentType === 'kb_knowledge' ? 'kb_knowledge' : 'incident'

    try {
      await serviceNowApiGet(
        normalizedUrl,
        tableName,
        authHeader,
        {
          sysparm_limit: '1',
          sysparm_offset: '0',
        },
        VALIDATE_RETRY_OPTIONS
      )
      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to connect to ServiceNow' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.type === 'string') {
      result.type = metadata.type === 'kb_article' ? 'KB Article' : 'Incident'
    }

    const state = metadata.state ?? metadata.workflowState
    if (typeof state === 'string') {
      result.state = state
    }

    if (typeof metadata.priority === 'string') {
      result.priority = metadata.priority
    }

    if (typeof metadata.category === 'string') {
      result.category = metadata.category
    }

    const author = metadata.author
    if (typeof author === 'string') {
      result.author = author
    }

    const lastUpdated = parseTagDate(metadata.lastUpdated)
    if (lastUpdated) {
      result.lastUpdated = lastUpdated
    }

    return result
  },
}
