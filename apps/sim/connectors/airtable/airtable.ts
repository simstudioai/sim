import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { airtableConnectorMeta } from '@/connectors/airtable/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  ConnectorListingScopeUnavailableError,
  computeContentHash,
  isListingScopeUnavailableError,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('AirtableConnector')

const AIRTABLE_API = 'https://api.airtable.com/v0'
/** Airtable caps `pageSize` at 100 (list records). */
const PAGE_SIZE = 100

/**
 * Renders a single cell object as stable plain text.
 *
 * Attachment cell values carry `url` / `thumbnails` links that Airtable expires
 * roughly two hours after they are returned, so they differ on every sync.
 * Serializing them would change the record's content hash on every run and force
 * a full re-index of every record that holds an attachment. Only the stable,
 * identifying properties of the documented cell shapes are rendered: attachment
 * `filename`, collaborator `name` / `email` / `id`, barcode `text`, button `label`,
 * and AI Text `value`.
 */
function formatCellObject(value: Record<string, unknown>): string {
  const stable = value.filename ?? value.name ?? value.text ?? value.label
  if (typeof stable === 'string' || typeof stable === 'number' || typeof stable === 'boolean') {
    return String(stable)
  }
  if (typeof value.id === 'string') return value.id
  if (typeof value.email === 'string') return value.email
  /**
   * AI Text cells carry the generated text in `value` (`{ state, isStale, value }`)
   * and match none of the probes above. Read last so a shape carrying both `name`
   * and `value` keeps its name. Unlike the attachment links this renderer exists to
   * avoid, the generated text is stable rather than an expiring signed URL, so
   * including it does not reintroduce per-sync hash churn.
   */
  if (typeof value.value === 'string') return value.value
  return ''
}

/**
 * Renders an object- or array-valued cell, dropping items that render to nothing.
 * Array items recurse, so a nested lookup array — documented as
 * `array<number | string | boolean | unknown>` — renders its elements instead of
 * collapsing to an empty string.
 */
function formatCellValue(value: object): string {
  if (!Array.isArray(value)) return formatCellObject(value as Record<string, unknown>)
  return value
    .map((item) => {
      if (Array.isArray(item)) return formatCellValue(item)
      return typeof item === 'object' && item !== null
        ? formatCellObject(item as Record<string, unknown>)
        : String(item)
    })
    .filter((item) => item.length > 0)
    .join(', ')
}

/**
 * Flattens a record's fields into a plain-text representation.
 * Each field is rendered as "Field Name: value" on its own line.
 */
function recordToPlainText(fields: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue
    if (typeof value === 'object') {
      const rendered = formatCellValue(value)
      if (!rendered) continue
      lines.push(`${key}: ${rendered}`)
    } else {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  return lines.join('\n')
}

/**
 * Airtable long-text cells are unbounded, so a title derived from one is capped
 * to keep document titles readable in the knowledge base UI.
 */
const MAX_TITLE_LENGTH = 200

/** Field names tried, in order, when no `titleField` is configured or it is empty. */
const TITLE_FALLBACK_FIELDS = ['Name', 'Title', 'name', 'title', 'Summary', 'summary'] as const

/** Renders a candidate cell as a title, or null when it holds nothing usable. */
function renderTitle(value: unknown): string | null {
  if (value == null) return null
  const rendered = typeof value === 'object' ? formatCellValue(value).trim() : String(value).trim()
  if (!rendered) return null
  return rendered.length > MAX_TITLE_LENGTH ? `${rendered.slice(0, MAX_TITLE_LENGTH)}…` : rendered
}

/**
 * Extracts a human-readable title from a record's fields.
 * Prefers the configured title field, then falls back to common field names.
 */
function extractTitle(fields: Record<string, unknown>, titleField?: string): string {
  if (titleField) {
    const fromConfigured = renderTitle(fields[titleField])
    if (fromConfigured) return fromConfigured
  }
  for (const candidate of TITLE_FALLBACK_FIELDS) {
    const fromCandidate = renderTitle(fields[candidate])
    if (fromCandidate) return fromCandidate
  }
  for (const value of Object.values(fields)) {
    if (typeof value !== 'string') continue
    const rendered = renderTitle(value)
    if (rendered) return rendered
  }
  return 'Untitled'
}

/**
 * Parses the cursor format: "offset:<airtable_offset>"
 */
function parseCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined
  if (cursor.startsWith('offset:')) return cursor.slice(7)
  return cursor
}

function readConfigString(sourceConfig: Record<string, unknown>, key: string): string | undefined {
  const raw = sourceConfig[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Parses the optional `maxRecords` cap; Airtable requires a positive integer. */
function readMaxRecords(sourceConfig: Record<string, unknown>): number {
  const raw = sourceConfig.maxRecords
  if (raw == null || raw === '') return 0
  const parsed = Math.floor(Number(raw))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export const airtableConnector: ConnectorConfig = {
  ...airtableConnectorMeta,

  isListingScopeUnavailableError: isListingScopeUnavailableError,

  /**
   * Lists records from `GET /v0/{baseId}/{tableIdOrName}`.
   *
   * Scope semantics that matter for deletion reconciliation:
   * - A configured `view` is an intentional scope filter: the source set *is*
   *   the view. A record leaving the view is indistinguishable from a deleted
   *   record over this API, and both should drop out of the knowledge base, so
   *   `listingCapped` is deliberately NOT set for view scoping.
   * - `maxRecords` truncates a listing that still has records behind it, so it
   *   sets `listingCapped` to suppress hard deletion of the records beyond the
   *   cap.
   */
  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const baseId = readConfigString(sourceConfig, 'baseId')
    const tableIdOrName = readConfigString(sourceConfig, 'tableIdOrName')
    if (!baseId || !tableIdOrName) {
      throw new Error('Airtable connector is missing baseId or tableIdOrName')
    }
    const viewId = readConfigString(sourceConfig, 'viewId')
    const titleField = readConfigString(sourceConfig, 'titleField')
    const maxRecords = readMaxRecords(sourceConfig)

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const tableId = await resolveTableId(accessToken, baseId, tableIdOrName, syncContext)

    /**
     * `pageSize` is held at the documented maximum for every request of a sync.
     * Airtable already stops pagination itself once `maxRecords` is reached, and
     * its `offset` is an opaque iterator token whose validity across a changed
     * `pageSize` is undocumented — so shrinking the last page would buy nothing
     * and risk breaking iteration mid-sync.
     */
    const params = new URLSearchParams()
    params.append('pageSize', String(PAGE_SIZE))
    if (viewId) params.append('view', viewId)
    if (maxRecords > 0) params.append('maxRecords', String(maxRecords))

    const offset = parseCursor(cursor)
    if (offset) params.append('offset', offset)

    const encodedBase = encodeURIComponent(baseId)
    const encodedTable = encodeURIComponent(tableIdOrName)
    const url = `${AIRTABLE_API}/${encodedBase}/${encodedTable}?${params.toString()}`

    logger.info(`Listing records from ${baseId}/${tableIdOrName}`, {
      offset: offset ?? 'none',
      view: viewId ?? 'default',
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Airtable records', {
        status: response.status,
        error: errorText,
      })
      /**
       * Airtable expires the list iterator after a period of inactivity and
       * answers a stale `offset` with 422 LIST_RECORDS_ITERATOR_NOT_AVAILABLE.
       * Throwing aborts the sync before reconciliation, which is the safe
       * outcome — the next run restarts iteration from the beginning.
       */
      const message = `Failed to list Airtable records: ${response.status}`
      /**
       * Airtable answers a base or table the caller cannot reach with 403
       * (INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND) or 404: the configured scope
       * is out of this caller's reach.
       */
      throw response.status === 403 || response.status === 404
        ? new ConnectorListingScopeUnavailableError(message, response.status)
        : new Error(message)
    }

    const data = (await response.json()) as {
      records?: AirtableRecord[]
      offset?: string
    }

    const records = data.records ?? []
    const documents: ExternalDocument[] = await Promise.all(
      records.map((record) => recordToDocument(record, baseId, tableId, titleField))
    )

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const nextOffset = data.offset
    const hitLimit = maxRecords > 0 && totalFetched >= maxRecords
    /**
     * Airtable enforces `maxRecords` itself — "pagination will stop once you've
     * reached this maximum" — but does not document whether it still returns an
     * `offset` at that point, so an exhausted source and a capped one cannot be
     * told apart here. Flagged conservatively: a capped listing must never let
     * the engine hard-delete the records the cap hid. The cost is that deletion
     * reconciliation only runs for a capped source on an explicit full resync.
     */
    if (hitLimit && syncContext) syncContext.listingCapped = true

    return {
      documents,
      nextCursor: !hitLimit && nextOffset ? `offset:${nextOffset}` : undefined,
      hasMore: !hitLimit && Boolean(nextOffset),
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const baseId = readConfigString(sourceConfig, 'baseId')
    const tableIdOrName = readConfigString(sourceConfig, 'tableIdOrName')
    /** A broken config is not evidence the record is gone, so it must not read as absence. */
    if (!baseId || !tableIdOrName) {
      throw new Error('Airtable connector is missing baseId or tableIdOrName')
    }
    const titleField = readConfigString(sourceConfig, 'titleField')

    const tableId = await resolveTableId(accessToken, baseId, tableIdOrName, syncContext)
    const encodedBase = encodeURIComponent(baseId)
    const encodedTable = encodeURIComponent(tableIdOrName)
    const url = `${AIRTABLE_API}/${encodedBase}/${encodedTable}/${encodeURIComponent(externalId)}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) return null
      throw new Error(`Failed to get Airtable record: ${response.status}`)
    }

    const record = (await response.json()) as AirtableRecord
    return recordToDocument(record, baseId, tableId, titleField)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const baseId = readConfigString(sourceConfig, 'baseId')
    const tableIdOrName = readConfigString(sourceConfig, 'tableIdOrName')

    if (!baseId || !tableIdOrName) {
      return { valid: false, error: 'Base ID and table name are required' }
    }

    if (!baseId.startsWith('app')) {
      return { valid: false, error: 'Base ID should start with "app"' }
    }

    const rawMaxRecords = sourceConfig.maxRecords
    if (rawMaxRecords != null && rawMaxRecords !== '') {
      const parsed = Number(rawMaxRecords)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { valid: false, error: 'Max records must be a positive whole number' }
      }
    }

    try {
      const encodedBase = encodeURIComponent(baseId)
      const encodedTable = encodeURIComponent(tableIdOrName)
      const url = `${AIRTABLE_API}/${encodedBase}/${encodedTable}?pageSize=1`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 404 || response.status === 422) {
          return { valid: false, error: `Table "${tableIdOrName}" not found in base "${baseId}"` }
        }
        if (response.status === 403) {
          return { valid: false, error: 'Access denied. Check your Airtable permissions.' }
        }
        return { valid: false, error: `Airtable API error: ${response.status} - ${errorText}` }
      }

      const viewId = readConfigString(sourceConfig, 'viewId')
      if (viewId) {
        const viewUrl = `${AIRTABLE_API}/${encodedBase}/${encodedTable}?pageSize=1&view=${encodeURIComponent(viewId)}`
        const viewResponse = await fetchWithRetry(
          viewUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          VALIDATE_RETRY_OPTIONS
        )
        if (!viewResponse.ok) {
          return { valid: false, error: `View "${viewId}" not found in table "${tableIdOrName}"` }
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

    const createdTime = parseTagDate(metadata.createdTime)
    if (createdTime) result.createdTime = createdTime

    return result
  },
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
  createdTime: string
}

/**
 * Converts an Airtable record to an ExternalDocument.
 *
 * `tableId` is the `tbl…` identifier when it could be resolved — Airtable
 * record deep links are only valid with the table ID, never the table name.
 */
async function recordToDocument(
  record: AirtableRecord,
  baseId: string,
  tableId: string | undefined,
  titleField: string | undefined
): Promise<ExternalDocument> {
  const fields = record.fields ?? {}
  const plainText = recordToPlainText(fields)
  const contentHash = await computeContentHash(plainText)
  const title = extractTitle(fields, titleField)

  const sourceUrl = tableId
    ? `https://airtable.com/${baseId}/${tableId}/${record.id}`
    : `https://airtable.com/${baseId}`

  return {
    externalId: record.id,
    title,
    content: plainText,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash,
    metadata: {
      createdTime: record.createdTime,
    },
  }
}

/**
 * Resolves the configured table reference to its `tbl…` ID via the Meta API
 * (`GET /v0/meta/bases/{baseId}/tables`, `schema.bases:read`), cached in
 * `syncContext` so a sync spends at most one extra request against the 5 req/s
 * per-base rate limit. Returns undefined when the schema is unreadable — the
 * record link degrades to the base link rather than emitting a broken URL.
 */
async function resolveTableId(
  accessToken: string,
  baseId: string,
  tableIdOrName: string,
  syncContext?: Record<string, unknown>
): Promise<string | undefined> {
  if (tableIdOrName.startsWith('tbl')) return tableIdOrName

  const cacheKey = `tableId:${baseId}/${tableIdOrName}`
  if (syncContext && cacheKey in syncContext) {
    return syncContext[cacheKey] as string | undefined
  }

  let resolved: string | undefined

  try {
    const url = `${AIRTABLE_API}/meta/bases/${encodeURIComponent(baseId)}/tables`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.ok) {
      const data = (await response.json()) as { tables?: { id: string; name: string }[] }
      resolved = (data.tables ?? []).find((t) => t.name === tableIdOrName)?.id
    } else {
      logger.warn('Failed to fetch Airtable base schema; record links will point at the base', {
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('Error fetching Airtable base schema', {
      error: toError(error).message,
    })
  }

  if (syncContext) syncContext[cacheKey] = resolved
  return resolved
}
