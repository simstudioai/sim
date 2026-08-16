import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { googleSheetsConnectorMeta } from '@/connectors/google-sheets/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  markSkipped,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
} from '@/connectors/utils'

const logger = createLogger('GoogleSheetsConnector')

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files'
const MAX_ROWS = 10000
const MAX_CONTENT_BYTES = CONNECTOR_MAX_FILE_BYTES

interface SheetProperties {
  sheetId: number
  title: string
  index: number
  /**
   * `GRID` (the documented default), `OBJECT` for a chart/image tab that "has no
   * grid", or `DATA_SOURCE` for a connected-data preview. Only grid-backed tabs
   * hold cell values.
   */
  sheetType?: 'SHEET_TYPE_UNSPECIFIED' | 'GRID' | 'OBJECT' | 'DATA_SOURCE'
  gridProperties?: {
    rowCount?: number
    columnCount?: number
  }
}

interface SpreadsheetMetadata {
  spreadsheetId: string
  properties: {
    title: string
  }
  sheets?: { properties: SheetProperties }[]
}

/**
 * True when the tab holds cell values. `OBJECT` sheets (charts, images) have no
 * grid at all, so a `values.get` against one only wastes a request from the
 * 60-reads-per-minute-per-user Sheets quota and can never yield content.
 * An absent `sheetType` means `GRID` per the SheetProperties default.
 */
function isGridSheet(sheet: SheetProperties): boolean {
  return sheet.sheetType !== 'OBJECT'
}

/**
 * A1 range covering every column of the first {@link MAX_ROWS} rows of a tab.
 *
 * A row-only range is used deliberately instead of a column-bounded one — the A1
 * guide documents `Sheet1!1:2` as "all the cells in the first two rows of Sheet1"
 * — because a sheet may hold up to 18,278 columns (column `ZZZ`, per the Drive
 * size-limits support article) and a hard-coded `A1:ZZ` ceiling (column 702)
 * would silently drop every column past it. Sheet names are wrapped in single
 * quotes: "Single quotes are required for sheet names with spaces or special
 * characters." The `''` escape for an embedded apostrophe is carried over
 * unchanged from the previous range builder; it matches the Sheets UI but is not
 * documented, and the guide's own `'Jon's_Data'` example leaves it unescaped.
 */
function sheetRowRange(sheetTitle: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!1:${MAX_ROWS}`
}

/**
 * Formats sheet rows into an LLM-friendly text representation, stopping as soon
 * as the byte budget is exceeded so a very large tab can never be materialized
 * in full. Reports `exceeded` instead of silently truncating, letting the caller
 * surface the tab as a visible skipped document.
 */
function buildSheetContent(
  headers: string[],
  rows: string[][],
  maxBytes: number
): { content: string; exceeded: boolean } {
  if (headers.length === 0) return { content: '', exceeded: false }

  const lines: string[] = []
  let bytes = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowLines = [`Row ${i + 1}:`]
    for (let j = 0; j < headers.length; j++) {
      const value = j < row.length ? row[j] : ''
      rowLines.push(`  ${headers[j]}: ${value}`)
    }
    rowLines.push('')

    for (const line of rowLines) {
      bytes += Buffer.byteLength(line, 'utf8') + 1
    }
    if (bytes > maxBytes) {
      return { content: '', exceeded: true }
    }
    lines.push(...rowLines)
  }

  return { content: lines.join('\n').trim(), exceeded: false }
}

/**
 * Fetches all values from a single sheet tab.
 *
 * The response body is read against a hard byte cap rather than being parsed
 * blindly: `MAX_ROWS` rows across up to 18,278 columns can produce a JSON
 * payload far larger than a document the knowledge base would accept.
 * `oversized` distinguishes "too big to index" from "no data".
 */
async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<{ values: string[][]; oversized: boolean }> {
  const range = sheetRowRange(sheetTitle)
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch sheet values for "${sheetTitle}": ${response.status}`)
  }

  const body = await readBodyWithLimit(response, MAX_CONTENT_BYTES)
  if (!body) {
    logger.warn('Sheet values response exceeded the size limit', { sheetTitle })
    return { values: [], oversized: true }
  }

  const data = JSON.parse(body.toString('utf8'))
  const values = (data.values || []) as string[][]

  if (values.length >= MAX_ROWS) {
    logger.warn('Sheet content truncated at the row limit', {
      sheetTitle,
      maxRows: MAX_ROWS,
    })
  }

  return { values, oversized: false }
}

/**
 * Fetches spreadsheet metadata (title, sheet names, grid properties).
 */
async function fetchSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch spreadsheet metadata: ${response.status}`)
  }

  return (await response.json()) as SpreadsheetMetadata
}

/**
 * Drive `files.get` metadata for the backing spreadsheet file.
 *
 * `trashed` is the Drive v3 File boolean meaning "whether the file has been
 * trashed, either explicitly or from a trashed parent folder". Both fields are
 * optional here because a failed Drive read yields an empty object.
 */
export interface DriveFileMetadata {
  modifiedTime?: string
  trashed?: boolean
}

/**
 * Reports whether the spreadsheet's Drive file is in the trash.
 *
 * Trashing a Drive file does not make it unreadable: Drive keeps trashed files
 * accessible by ID before permanent deletion ("other users can still access the
 * file in the owner's trash until it's permanently deleted"), so
 * `spreadsheets.get` keeps succeeding and every tab keeps appearing in the
 * listing. Since KB deletion reconciliation only purges stored documents that
 * are absent from a full listing, a trashed spreadsheet's tabs would otherwise
 * live in the knowledge base forever — and once the file is purged the Sheets
 * call 404s, the listing throws, and reconciliation never runs at all.
 *
 * Fails open: only an explicit `trashed === true` counts. A missing field or a
 * failed Drive read (which returns `{}`) is treated as not trashed, because a
 * wrongful exclusion would hard-delete still-current documents.
 */
export function isTrashedDriveFile(metadata: DriveFileMetadata): boolean {
  return metadata.trashed === true
}

/**
 * Narrows an untyped Drive `files.get` response body to the fields we consume.
 */
export function parseDriveFileMetadata(data: unknown): DriveFileMetadata {
  if (typeof data !== 'object' || data === null) return {}
  const record = data as Record<string, unknown>
  return {
    ...(typeof record.modifiedTime === 'string' ? { modifiedTime: record.modifiedTime } : {}),
    ...(typeof record.trashed === 'boolean' ? { trashed: record.trashed } : {}),
  }
}

/**
 * Fetches the spreadsheet's `modifiedTime` and `trashed` state from the Drive API.
 * Returns an empty object when the Drive read fails so callers fail open.
 */
async function fetchDriveFileMetadata(
  accessToken: string,
  spreadsheetId: string,
  retryOptions?: RetryOptions
): Promise<DriveFileMetadata> {
  try {
    const url = `${DRIVE_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime,trashed&supportsAllDrives=true`
    const response = await fetchWithRetry(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      retryOptions
    )

    if (!response.ok) {
      logger.warn('Failed to fetch file metadata from Drive API', { status: response.status })
      return {}
    }

    return parseDriveFileMetadata(await response.json())
  } catch (error) {
    logger.warn('Error fetching file metadata from Drive API', {
      error: toError(error).message,
    })
    return {}
  }
}

interface SpreadsheetContext {
  metadata: SpreadsheetMetadata
  driveMetadata: DriveFileMetadata
}

/**
 * Loads the spreadsheet's Sheets metadata and Drive file metadata once per sync
 * run, caching both in `syncContext`.
 *
 * Without the cache every deferred hydration re-reads them, so a workbook with N
 * tabs costs `3N` requests instead of `N + 2` — and the Sheets API allows only 60
 * read requests per minute per user, so a few dozen tabs is enough to spend the
 * whole sync in 429 backoff.
 */
async function loadSpreadsheetContext(
  accessToken: string,
  spreadsheetId: string,
  syncContext?: Record<string, unknown>
): Promise<SpreadsheetContext> {
  const cacheKey = `gsheets:context:${spreadsheetId}`
  const cached = syncContext?.[cacheKey] as SpreadsheetContext | undefined
  if (cached) return cached

  const [metadata, driveMetadata] = await Promise.all([
    fetchSpreadsheetMetadata(accessToken, spreadsheetId),
    fetchDriveFileMetadata(accessToken, spreadsheetId),
  ])

  const context: SpreadsheetContext = { metadata, driveMetadata }
  if (syncContext) syncContext[cacheKey] = context
  return context
}

/**
 * Builds the listing stub for a tab. Shared by `listDocuments` and `getDocument`
 * so the `contentHash` is byte-identical on both paths and an unchanged tab is
 * never re-indexed.
 */
function sheetToStub(
  spreadsheetId: string,
  spreadsheetTitle: string,
  sheet: SheetProperties,
  modifiedTime: string | undefined,
  metadata: Record<string, unknown>
): ExternalDocument {
  return {
    externalId: `${spreadsheetId}__sheet__${sheet.sheetId}`,
    title: `${spreadsheetTitle} - ${sheet.title}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheet.sheetId}`,
    contentHash: `gsheets:${spreadsheetId}:${sheet.sheetId}:${modifiedTime ?? ''}`,
    metadata: {
      spreadsheetId,
      spreadsheetTitle,
      sheetTitle: sheet.title,
      sheetId: sheet.sheetId,
      ...(modifiedTime ? { modifiedTime } : {}),
      ...metadata,
    },
  }
}

/**
 * Converts a single sheet tab into an ExternalDocument with its content loaded.
 */
async function sheetToDocument(
  accessToken: string,
  spreadsheetId: string,
  spreadsheetTitle: string,
  sheet: SheetProperties,
  modifiedTime?: string
): Promise<ExternalDocument | null> {
  const stub = sheetToStub(spreadsheetId, spreadsheetTitle, sheet, modifiedTime, {})

  try {
    const { values, oversized } = await fetchSheetValues(accessToken, spreadsheetId, sheet.title)

    if (oversized) {
      return markSkipped(stub, sizeLimitSkipReason(MAX_CONTENT_BYTES))
    }

    if (values.length === 0) {
      logger.info(`Skipping empty sheet: ${sheet.title}`)
      return null
    }

    /**
     * "Empty trailing rows and columns are omitted" from a values response, so
     * rows come back ragged and a row can be wider than the header row (a blank
     * header cell above populated data). Sizing the table by the widest row —
     * not by the header row — keeps those columns from being dropped.
     */
    const width = values.reduce((max, row) => Math.max(max, row.length), 0)
    const headerRow = values[0]
    const headers = Array.from({ length: width }, (_, idx) => {
      const header = headerRow[idx]
      return typeof header === 'string' && header.trim() ? header.trim() : `Column ${idx + 1}`
    })
    const dataRows = values.slice(1)

    if (dataRows.length === 0) {
      logger.info(`Skipping header-only sheet: ${sheet.title}`)
      return null
    }

    const { content, exceeded } = buildSheetContent(headers, dataRows, MAX_CONTENT_BYTES)
    if (exceeded) {
      logger.warn('Sheet content exceeded the size limit', { sheetTitle: sheet.title })
      return markSkipped(stub, sizeLimitSkipReason(MAX_CONTENT_BYTES))
    }
    if (!content.trim()) {
      return null
    }

    return {
      ...stub,
      content,
      contentDeferred: false,
      metadata: {
        ...stub.metadata,
        rowCount: dataRows.length,
        columnCount: headers.length,
      },
    }
  } catch (error) {
    /**
     * Empty, header-only, and oversized tabs are already resolved above. A values-fetch
     * failure is transient, so it propagates and fails hydration — which is exactly what
     * `listDocuments` documents as the outcome. Returning null here would instead drop
     * the tab from the run with no failed row and no error recorded.
     */
    logger.warn(`Failed to extract content from sheet: ${sheet.title}`, {
      error: toError(error).message,
    })
    throw toError(error)
  }
}

export const googleSheetsConnector: ConnectorConfig = {
  ...googleSheetsConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const spreadsheetId = (sourceConfig.spreadsheetId as string)?.trim()
    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID is required')
    }

    logger.info('Fetching spreadsheet metadata', { spreadsheetId })

    const { metadata, driveMetadata } = await loadSpreadsheetContext(
      accessToken,
      spreadsheetId,
      syncContext
    )

    /**
     * A trashed spreadsheet is no longer current content, so it drops out of the
     * listing and stops being re-indexed. The sync engine reconciles its absence
     * the same way it does for every connector: pending-removal on the first
     * sync that doesn't see it, purged once a later sync confirms it's still
     * gone. `validateConfig` reports the trashed state so the connector does not
     * look healthy while serving tabs from a file its owner has thrown away.
     */
    if (isTrashedDriveFile(driveMetadata)) {
      logger.info('Spreadsheet is in the Drive trash; listing no documents', { spreadsheetId })
      return { documents: [], hasMore: false }
    }

    const modifiedTime = driveMetadata.modifiedTime
    const sheetFilter = (sourceConfig.sheetFilter as string) || 'all'

    /**
     * Ordered by `index` (the tab's position in the UI) so "first sheet only"
     * resolves to the leftmost tab regardless of response ordering. Sorted on a
     * copy — the array belongs to the cached spreadsheet context.
     */
    let sheets = (metadata.sheets ?? [])
      .map((s) => s.properties)
      .filter(isGridSheet)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

    if (sheetFilter === 'first' && sheets.length > 0) {
      sheets = [sheets[0]]
    }

    logger.info('Processing sheets', {
      spreadsheetTitle: metadata.properties.title,
      sheetCount: sheets.length,
    })

    const documents = sheets.map((sheet) =>
      sheetToStub(spreadsheetId, metadata.properties.title, sheet, modifiedTime, {
        rowCount: sheet.gridProperties?.rowCount,
        columnCount: sheet.gridProperties?.columnCount,
      })
    )

    /**
     * No `listingCapped`: every non-object tab of the configured spreadsheet is
     * listed on every run, so an absent document genuinely no longer exists and
     * must reconcile. `sheetFilter: 'first'` is an intentional scope filter, and
     * a per-tab values failure only fails hydration — the tab still appears in
     * the listing, so it is never a candidate for deletion.
     */
    return {
      documents,
      hasMore: false,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const parts = externalId.split('__sheet__')
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
      logger.warn('Invalid external ID format', { externalId })
      return null
    }

    const spreadsheetId = parts[0]
    const sheetId = Number(parts[1])

    let context: SpreadsheetContext
    try {
      context = await loadSpreadsheetContext(accessToken, spreadsheetId, syncContext)
    } catch (error) {
      const message = toError(error).message
      if (message.includes('404')) {
        logger.info('Spreadsheet not found (possibly deleted)', { spreadsheetId })
        return null
      }
      throw error
    }

    /** Mirrors the listing: a trashed spreadsheet is still readable but no longer current. */
    if (isTrashedDriveFile(context.driveMetadata)) {
      logger.info('Spreadsheet is in the Drive trash', { spreadsheetId })
      return null
    }

    const sheetEntry = (context.metadata.sheets ?? []).find(
      (s) => s.properties.sheetId === sheetId && isGridSheet(s.properties)
    )

    if (!sheetEntry) {
      logger.info('Sheet not found in spreadsheet', { spreadsheetId, sheetId })
      return null
    }

    return sheetToDocument(
      accessToken,
      spreadsheetId,
      context.metadata.properties.title,
      sheetEntry.properties,
      context.driveMetadata.modifiedTime
    )
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const spreadsheetId = (sourceConfig.spreadsheetId as string)?.trim()

    if (!spreadsheetId) {
      return { valid: false, error: 'Spreadsheet ID is required' }
    }

    try {
      const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title`

      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 404) {
          return {
            valid: false,
            error: 'Spreadsheet not found. Check the ID and ensure it is shared with your account.',
          }
        }
        if (response.status === 403) {
          return {
            valid: false,
            error: 'Access denied. Ensure the spreadsheet is shared with your Google account.',
          }
        }
        return { valid: false, error: `Failed to access spreadsheet: ${response.status}` }
      }

      /**
       * A trashed spreadsheet still reads back fine from the Sheets API, so without
       * this check the connector would validate and then sync zero documents. Fails
       * open exactly like the sync paths: only an explicit `trashed === true` blocks
       * validation, and a failed Drive read leaves the config valid.
       */
      const driveMetadata = await fetchDriveFileMetadata(
        accessToken,
        spreadsheetId,
        VALIDATE_RETRY_OPTIONS
      )
      if (isTrashedDriveFile(driveMetadata)) {
        return {
          valid: false,
          error:
            'This spreadsheet is in the Google Drive trash. Restore it in Drive, then try again.',
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

    if (typeof metadata.sheetTitle === 'string') {
      result.sheetTitle = metadata.sheetTitle
    }

    if (typeof metadata.rowCount === 'number') {
      result.rowCount = metadata.rowCount
    }

    if (typeof metadata.columnCount === 'number') {
      result.columnCount = metadata.columnCount
    }

    const lastModified = parseTagDate(metadata.modifiedTime)
    if (lastModified) {
      result.lastModified = lastModified
    }

    return result
  },
}
