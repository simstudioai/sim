import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { microsoftExcelConnectorMeta } from '@/connectors/microsoft-excel/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { markSkipped, parseTagDate, readBodyWithLimit } from '@/connectors/utils'
import type { ExcelCellValue } from '@/tools/microsoft_excel/types'
import {
  escapeODataString,
  getItemBasePath,
  parseGraphErrorMessage,
  trimTrailingEmptyRowsAndColumns,
} from '@/tools/microsoft_excel/utils'

const logger = createLogger('MicrosoftExcelConnector')

/**
 * Separator between the workbook drive-item ID and the worksheet ID inside an
 * `externalId`. Graph worksheet IDs are brace-wrapped GUIDs (`{FC03…A0}`), so they
 * never contain this token.
 */
const SHEET_SEPARATOR = '__sheet__'

/**
 * Version token folded into `contentHash`. The hash is metadata-based (workbook
 * `lastModifiedDateTime`), so a change to *how* cell content is rendered would
 * otherwise leave every already-indexed worksheet on the old rendering until the
 * workbook itself is edited. Bump this whenever the indexed text changes shape.
 * `v2` = displayed `text` values instead of raw serial-number `values`.
 */
const CONTENT_FORMAT_VERSION = 'v2'

/**
 * Hard ceiling on the number of worksheets listed from a single workbook. Excel
 * allows far more sheets than any knowledge base should absorb in one sync, so the
 * listing stops here and flags `listingCapped` to keep deletion reconciliation from
 * purging the sheets past the cap.
 */
const MAX_WORKSHEETS = 500

/**
 * Origin every Graph response must stay on. `@odata.nextLink` is server-supplied
 * and carries the bearer token when followed, so a link pointing anywhere else is
 * dropped rather than requested.
 */
const GRAPH_API_BASE = 'https://graph.microsoft.com/'

/** Maximum rows read from a single worksheet's used range. */
const MAX_ROWS = 5000

/** Maximum columns read from a single worksheet's used range. */
const MAX_COLUMNS = 200

/**
 * Maximum cells read from a single worksheet. A workbook can declare a used range
 * of millions of cells, and Graph serializes every one of them into the JSON body,
 * so the row/column caps alone are not enough — the row cap is tightened further
 * until the rectangle fits this budget.
 */
const MAX_CELLS = 200_000

/**
 * Byte ceiling on a single range response. The caps above bound the *requested*
 * rectangle, but individual cells carry arbitrary user text, so the body is read
 * through a streaming limiter and abandoned rather than buffered if it overruns.
 */
const MAX_RANGE_RESPONSE_BYTES = 16 * 1024 * 1024

/**
 * Byte ceiling on the used-range *metadata* response. `$select=address` keeps that
 * body to a few hundred bytes, but Graph documents that unsupported query
 * parameters can "fail silently" (https://learn.microsoft.com/en-us/graph/query-parameters
 * — "Error handling for query parameters"), and the `usedRange` reference page — unlike
 * `worksheets` — has no "Optional query parameters" section promising `$select` support.
 * If the projection is ever dropped, Graph serializes the whole grid (values, text,
 * formulas, numberFormat, valueTypes) into this response, so it is read through the
 * streaming limiter too: the dimensions-only design degrades to a skipped worksheet
 * rather than an unbounded buffer.
 */
const MAX_USED_RANGE_RESPONSE_BYTES = 1024 * 1024

interface Worksheet {
  id: string
  name: string
  position: number
  visibility?: string
}

interface WorksheetListResponse {
  value?: Worksheet[]
  '@odata.nextLink'?: string
}

interface WorkbookItem {
  id: string
  name?: string
  webUrl?: string
  lastModifiedDateTime?: string
}

interface UsedRangeMetadata {
  address?: string
}

interface RangeValues {
  address?: string
  text?: string[][]
  values?: ExcelCellValue[][]
}

/** A1-style rectangle, all bounds 1-based and inclusive. */
interface CellRect {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

/** Converts an A1 column label (`A`, `Z`, `AA`) to its 1-based index. */
export function columnLabelToIndex(label: string): number {
  let index = 0
  for (const char of label.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index
}

/** Converts a 1-based column index to its A1 label (`1` → `A`, `27` → `AA`). */
export function columnIndexToLabel(index: number): string {
  let remaining = index
  let label = ''
  while (remaining > 0) {
    const rest = (remaining - 1) % 26
    label = String.fromCharCode(65 + rest) + label
    remaining = Math.floor((remaining - 1) / 26)
  }
  return label
}

/**
 * Parses a Graph range address (`Sheet1!B2:F400`, `'My Sheet'!A1`) into its
 * rectangle. The sheet-name prefix is split on the LAST `!` because Excel permits
 * `!` inside a quoted sheet name. Returns `null` when the address is not an
 * absolute A1 rectangle we can bound.
 */
export function parseRangeAddress(address: string): CellRect | null {
  const bangIndex = address.lastIndexOf('!')
  const local = bangIndex === -1 ? address : address.slice(bangIndex + 1)
  const cellPattern = /^\$?([A-Za-z]+)\$?(\d+)$/

  const [startCell, endCell] = local.split(':')
  const start = startCell?.match(cellPattern)
  if (!start) return null

  const end = endCell ? endCell.match(cellPattern) : start
  if (!end) return null

  return {
    startRow: Number(start[2]),
    startColumn: columnLabelToIndex(start[1]),
    endRow: Number(end[2]),
    endColumn: columnLabelToIndex(end[1]),
  }
}

/**
 * Shrinks a used-range rectangle to the connector's row, column, and cell caps.
 * The rectangle is always anchored at the used range's top-left cell so the header
 * row survives; the column cap is applied first, then the row cap is tightened
 * further until the remaining rectangle fits {@link MAX_CELLS}.
 */
export function capRect(rect: CellRect): { rect: CellRect; capped: boolean } {
  const cappedEndColumn = Math.min(rect.endColumn, rect.startColumn + MAX_COLUMNS - 1)
  const columns = cappedEndColumn - rect.startColumn + 1
  const rowBudget = Math.max(1, Math.min(MAX_ROWS, Math.floor(MAX_CELLS / columns)))
  const cappedEndRow = Math.min(rect.endRow, rect.startRow + rowBudget - 1)

  return {
    rect: { ...rect, endColumn: cappedEndColumn, endRow: cappedEndRow },
    capped: cappedEndColumn < rect.endColumn || cappedEndRow < rect.endRow,
  }
}

/** Renders a rectangle as a sheet-relative A1 address (`B2:F400`). */
function formatRect(rect: CellRect): string {
  const start = `${columnIndexToLabel(rect.startColumn)}${rect.startRow}`
  const end = `${columnIndexToLabel(rect.endColumn)}${rect.endRow}`
  return start === end ? start : `${start}:${end}`
}

/** Normalizes a Graph cell value to the plain string used in indexed content. */
function cellToString(value: ExcelCellValue): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Formats worksheet rows into an LLM-friendly text representation, labelling each
 * row by index and each cell by its header name. Mirrors the Google Sheets
 * connector so both spreadsheet sources chunk identically.
 */
export function formatSheetContent(headers: string[], rows: ExcelCellValue[][]): string {
  if (headers.length === 0) return ''

  const lines: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    lines.push(`Row ${i + 1}:`)
    for (let j = 0; j < headers.length; j++) {
      lines.push(`  ${headers[j]}: ${cellToString(row[j])}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

/** Builds the Graph URL for a worksheet, addressing it by name (Graph accepts id or name). */
function worksheetUrl(basePath: string, sheetName: string): string {
  return `${basePath}/workbook/worksheets('${encodeURIComponent(escapeODataString(sheetName))}')`
}

/** Throws a Graph-formatted error for a failed response. */
async function graphError(response: Response, context: string): Promise<never> {
  const body = await response.text().catch(() => '')
  const detail = parseGraphErrorMessage(response.status, response.statusText, body)
  throw new Error(`${context}: ${detail}`)
}

/** Fetches the workbook drive item (name, webUrl, lastModifiedDateTime). */
async function fetchWorkbookItem(
  accessToken: string,
  basePath: string,
  retryOptions?: RetryOptions
): Promise<WorkbookItem | null> {
  const response = await fetchWithRetry(
    `${basePath}?$select=id,name,webUrl,lastModifiedDateTime`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    },
    retryOptions
  )

  if (response.status === 404 || response.status === 410) return null
  if (!response.ok) await graphError(response, 'Failed to fetch workbook')

  return (await response.json()) as WorkbookItem
}

/**
 * Lists the workbook's worksheets in tab order.
 *
 * `truncated` reports that the walk stopped while Graph was still offering more
 * sheets — either because `@odata.nextLink` pointed off the Graph origin and was
 * refused, or because the `MAX_WORKSHEETS` bound was reached. The caller must turn
 * that into `listingCapped`, otherwise the sync engine reconciles the unseen sheets
 * away as deletions.
 */
async function fetchWorksheets(
  accessToken: string,
  basePath: string
): Promise<{ worksheets: Worksheet[]; truncated: boolean }> {
  const worksheets: Worksheet[] = []
  let url: string | undefined =
    `${basePath}/workbook/worksheets?$select=id,name,position,visibility&$orderby=position`
  let truncated = false

  /**
   * Graph paginates collection responses, so a workbook with more sheets than fit
   * in one page must follow `@odata.nextLink`. Reading only the first page would
   * drop the remainder from the listing, and the sync engine would then reconcile
   * those documents away as deleted.
   */
  while (url && worksheets.length <= MAX_WORKSHEETS) {
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    if (!response.ok) await graphError(response, 'Failed to list worksheets')

    const data = (await response.json()) as WorksheetListResponse
    worksheets.push(...(data.value ?? []))

    const next = data['@odata.nextLink']
    if (next && !next.startsWith(GRAPH_API_BASE)) {
      logger.warn('Dropping off-origin @odata.nextLink while listing worksheets', { basePath })
      truncated = true
      url = undefined
    } else {
      url = next
    }
  }

  /** Exiting with a page still pending means the `MAX_WORKSHEETS` bound cut the walk short. */
  if (url) truncated = true

  /**
   * The `$orderby=position` above cannot be relied on. The worksheet-list reference
   * only says the method "supports the OData Query Parameters" without itemizing
   * which (https://learn.microsoft.com/en-us/graph/api/worksheet-list), and Graph
   * documents that unsupported query parameters "fail silently"
   * (https://learn.microsoft.com/en-us/graph/query-parameters — "Error handling for
   * query parameters"). Both the `first` sheet filter and the `MAX_WORKSHEETS` cut
   * pick by position, so the assembled list is re-sorted client-side to keep that
   * choice deterministic whether or not Graph honoured the projection.
   */
  worksheets.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  return { worksheets, truncated }
}

/**
 * Fetches the worksheet's used-range dimensions WITHOUT its values.
 * `$select` keeps the response to a few bytes, so the connector can decide how much
 * of a potentially enormous sheet to read before requesting any cell data.
 */
async function fetchUsedRangeMetadata(
  accessToken: string,
  basePath: string,
  sheetName: string
): Promise<UsedRangeMetadata | null> {
  const url = `${worksheetUrl(basePath, sheetName)}/usedRange(valuesOnly=true)?$select=address`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })

  if (response.status === 404) return null
  if (!response.ok) await graphError(response, `Failed to read used range for "${sheetName}"`)

  const buffer = await readBodyWithLimit(response, MAX_USED_RANGE_RESPONSE_BYTES)
  if (!buffer) throw new RangeTooLargeError(MAX_USED_RANGE_RESPONSE_BYTES)

  return JSON.parse(buffer.toString('utf8')) as UsedRangeMetadata
}

/**
 * Raised when a range response exceeds its byte ceiling. The body is abandoned
 * mid-stream rather than buffered, so the worksheet surfaces as a skipped document
 * instead of pulling an unbounded payload into memory.
 */
class RangeTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Worksheet range response exceeds ${maxBytes} bytes`)
    this.name = 'RangeTooLargeError'
  }
}

/**
 * Fetches the capped rectangle of cell values from a worksheet.
 *
 * Both `text` and `values` are projected. `values` carries the *raw* cell values, so a
 * date or currency cell comes back as its underlying serial number (`42019`, not
 * `1/15/2015`) — useless for retrieval. `text` carries the displayed strings and,
 * per the Range reference, "doesn't depend on the cell width. The # sign substitution
 * that happens in Excel UI doesn't affect the text value returned by the API"
 * (https://learn.microsoft.com/en-us/graph/api/resources/range), so it never degrades
 * to `#######`. This matches the Google Sheets connector's `FORMATTED_VALUE`.
 * `values` is kept only as a fallback for the rows `text` does not cover.
 */
async function fetchRangeValues(
  accessToken: string,
  basePath: string,
  sheetName: string,
  address: string
): Promise<RangeValues> {
  const url = `${worksheetUrl(basePath, sheetName)}/range(address='${encodeURIComponent(address)}')?$select=address,text,values`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })

  if (!response.ok) await graphError(response, `Failed to read range for "${sheetName}"`)

  const buffer = await readBodyWithLimit(response, MAX_RANGE_RESPONSE_BYTES)
  if (!buffer) throw new RangeTooLargeError(MAX_RANGE_RESPONSE_BYTES)

  return JSON.parse(buffer.toString('utf8')) as RangeValues
}

interface WorkbookSnapshot {
  workbook: WorkbookItem | null
  worksheets: Worksheet[]
  /** True when the worksheet walk stopped before Graph ran out of sheets. */
  worksheetsTruncated: boolean
}

/**
 * Loads the workbook drive item and its worksheet list, memoizing the in-flight promise
 * on `syncContext` for the duration of the sync run. The sync engine hydrates deferred
 * documents concurrently, so without this every worksheet in the workbook would repeat
 * both calls — 2N Graph requests against an API that throttles aggressively. A rejected
 * promise is evicted so a transient failure does not poison the rest of the run.
 */
async function loadWorkbookSnapshot(
  accessToken: string,
  basePath: string,
  spreadsheetId: string,
  syncContext?: Record<string, unknown>
): Promise<WorkbookSnapshot> {
  const cacheKey = `workbookSnapshot:${spreadsheetId}`
  const cached = syncContext?.[cacheKey] as Promise<WorkbookSnapshot> | undefined
  if (cached) return cached

  const pending = (async (): Promise<WorkbookSnapshot> => {
    const workbook = await fetchWorkbookItem(accessToken, basePath)
    if (!workbook) return { workbook: null, worksheets: [], worksheetsTruncated: false }
    const { worksheets, truncated } = await fetchWorksheets(accessToken, basePath)
    return { workbook, worksheets, worksheetsTruncated: truncated }
  })()

  if (syncContext) {
    syncContext[cacheKey] = pending
    pending.catch(() => {
      if (syncContext[cacheKey] === pending) delete syncContext[cacheKey]
    })
  }

  return pending
}

/** Composes the stable external ID for one worksheet inside a workbook. */
function buildExternalId(spreadsheetId: string, worksheetId: string): string {
  return `${spreadsheetId}${SHEET_SEPARATOR}${worksheetId}`
}

/** Splits an external ID back into its workbook and worksheet IDs. */
export function parseExternalId(
  externalId: string
): { spreadsheetId: string; worksheetId: string } | null {
  const index = externalId.indexOf(SHEET_SEPARATOR)
  if (index <= 0) return null

  const spreadsheetId = externalId.slice(0, index)
  const worksheetId = externalId.slice(index + SHEET_SEPARATOR.length)
  if (!spreadsheetId || !worksheetId) return null

  return { spreadsheetId, worksheetId }
}

/**
 * Builds the deferred listing stub for one worksheet. Used by both `listDocuments`
 * and `getDocument` so the metadata-based `contentHash` is byte-identical on both
 * paths — the sync engine compares them directly to decide what to re-index.
 */
function sheetToStub(
  spreadsheetId: string,
  workbook: WorkbookItem,
  sheet: Worksheet
): ExternalDocument {
  const workbookTitle = workbook.name ?? 'Workbook'
  return {
    externalId: buildExternalId(spreadsheetId, sheet.id),
    title: `${workbookTitle} - ${sheet.name}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: workbook.webUrl,
    contentHash: `microsoft_excel:${CONTENT_FORMAT_VERSION}:${spreadsheetId}:${sheet.id}:${workbook.lastModifiedDateTime ?? ''}`,
    metadata: {
      spreadsheetId,
      workbookName: workbookTitle,
      sheetTitle: sheet.name,
      worksheetId: sheet.id,
      position: sheet.position,
      visibility: sheet.visibility,
      lastModifiedDateTime: workbook.lastModifiedDateTime,
    },
  }
}

/** Resolves the workbook's Graph base path from the connector's source config. */
function resolveBasePath(sourceConfig: Record<string, unknown>): {
  spreadsheetId: string
  basePath: string
} {
  const spreadsheetId =
    typeof sourceConfig.spreadsheetId === 'string' ? sourceConfig.spreadsheetId.trim() : ''
  if (!spreadsheetId) {
    throw new Error('Workbook ID is required')
  }

  const driveId = typeof sourceConfig.driveId === 'string' ? sourceConfig.driveId.trim() : ''
  return { spreadsheetId, basePath: getItemBasePath(spreadsheetId, driveId || undefined) }
}

export const microsoftExcelConnector: ConnectorConfig = {
  ...microsoftExcelConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const { spreadsheetId, basePath } = resolveBasePath(sourceConfig)

    const { workbook, worksheets, worksheetsTruncated } = await loadWorkbookSnapshot(
      accessToken,
      basePath,
      spreadsheetId,
      syncContext
    )

    /**
     * A 404/410 means the drive item is gone for good, so the listing is genuinely
     * empty and reconciliation should purge the workbook's sheets. `listingCapped`
     * is deliberately NOT set here — a permissions failure surfaces as 401/403 and
     * throws from `fetchWorkbookItem` instead.
     */
    if (!workbook) {
      logger.info('Workbook not found; listing no documents', { spreadsheetId })
      return { documents: [], hasMore: false }
    }

    const sheetFilter = typeof sourceConfig.sheetFilter === 'string' ? sourceConfig.sheetFilter : ''
    const scoped = sheetFilter === 'first' ? worksheets.slice(0, 1) : worksheets

    const selected = scoped.slice(0, MAX_WORKSHEETS)

    /**
     * The listing is short of the workbook's real sheet set when the connector cap
     * trims it, or when the worksheet walk itself stopped early. `sheetFilter: 'first'`
     * is excluded on purpose — it is a deliberate scope choice, not a truncation, so
     * the unselected sheets must still reconcile as deletions.
     */
    const capped =
      selected.length < scoped.length || (sheetFilter !== 'first' && worksheetsTruncated)
    if (capped) {
      logger.warn('Worksheet listing truncated; suppressing deletion reconciliation', {
        spreadsheetId,
        listed: selected.length,
        cap: MAX_WORKSHEETS,
        worksheetsTruncated,
      })
      if (syncContext) syncContext.listingCapped = true
    }

    logger.info('Listing Microsoft Excel worksheets', {
      spreadsheetId,
      workbookName: workbook.name,
      sheetCount: selected.length,
    })

    return {
      documents: selected.map((sheet) => sheetToStub(spreadsheetId, workbook, sheet)),
      hasMore: false,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const parsed = parseExternalId(externalId)
    if (!parsed) {
      logger.warn('Invalid external ID format', { externalId })
      return null
    }

    const driveId = typeof sourceConfig.driveId === 'string' ? sourceConfig.driveId.trim() : ''
    const basePath = getItemBasePath(parsed.spreadsheetId, driveId || undefined)

    const { workbook, worksheets } = await loadWorkbookSnapshot(
      accessToken,
      basePath,
      parsed.spreadsheetId,
      syncContext
    )
    if (!workbook) {
      logger.info('Workbook not found', { spreadsheetId: parsed.spreadsheetId })
      return null
    }

    const sheet = worksheets.find((candidate) => candidate.id === parsed.worksheetId)
    if (!sheet) {
      logger.info('Worksheet no longer exists in the workbook', { externalId })
      return null
    }

    const stub = sheetToStub(parsed.spreadsheetId, workbook, sheet)

    try {
      const usedRange = await fetchUsedRangeMetadata(accessToken, basePath, sheet.name)
      const address = usedRange?.address
      if (!address) return null

      const rect = parseRangeAddress(address)
      if (!rect) {
        logger.warn('Unparseable used-range address', { externalId, address })
        return null
      }

      const { rect: capped, capped: wasCapped } = capRect(rect)
      if (wasCapped) {
        logger.warn('Worksheet content truncated by the connector cell caps', {
          externalId,
          usedRangeAddress: address,
          indexedRangeAddress: formatRect(capped),
        })
      }
      const range = await fetchRangeValues(accessToken, basePath, sheet.name, formatRect(capped))
      const values = trimTrailingEmptyRowsAndColumns(range.text ?? range.values ?? [])

      if (values.length < 2) return null

      const headers = values[0].map((header, index) => {
        const label = cellToString(header).trim()
        return label || `Column ${index + 1}`
      })

      const body = formatSheetContent(headers, values.slice(1))
      if (!body.trim()) return null

      const content = wasCapped
        ? `${body}\n\n[Truncated: only ${formatRect(capped)} of ${address} was indexed]`
        : body

      return {
        ...stub,
        content,
        contentDeferred: false,
        metadata: {
          ...stub.metadata,
          rowCount: values.length - 1,
          columnCount: headers.length,
          usedRangeAddress: address,
          indexedRangeAddress: formatRect(capped),
          truncated: wasCapped,
        },
      }
    } catch (error) {
      if (error instanceof RangeTooLargeError) {
        logger.info('Skipping oversized worksheet range', { externalId })
        return markSkipped(stub, 'Worksheet exceeds the connector size limit and was not indexed')
      }
      /**
       * Everything reaching here is a transport or Graph failure that survived
       * `fetchWithRetry`. Returning `null` reads to the sync engine as "no content",
       * which for a newly added worksheet is silent — no counter moves and nothing is
       * logged. Rethrowing surfaces it instead: the engine hydrates deferred documents
       * under `Promise.allSettled`, so one bad worksheet never aborts the run, and a
       * rejection increments `docsFailed`, logs the externalId, and marks it as an
       * unverified refresh so a tombstoned sheet is not resurrected on a failed fetch.
       */
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const sheetFilter = sourceConfig.sheetFilter
    if (
      sheetFilter !== undefined &&
      sheetFilter !== '' &&
      sheetFilter !== 'all' &&
      sheetFilter !== 'first'
    ) {
      return { valid: false, error: 'Sheets to Sync must be either "all" or "first"' }
    }

    let basePath: string
    try {
      basePath = resolveBasePath(sourceConfig).basePath
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Workbook ID is required') }
    }

    try {
      const workbook = await fetchWorkbookItem(accessToken, basePath, VALIDATE_RETRY_OPTIONS)
      if (!workbook) {
        return {
          valid: false,
          error: 'Workbook not found. Check the workbook ID and that your account can access it.',
        }
      }

      const response = await fetchWithRetry(
        `${basePath}/workbook/worksheets?$select=id&$top=1`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 403) {
          return {
            valid: false,
            error: 'Access denied. Ensure the workbook is shared with your Microsoft account.',
          }
        }
        if (response.status === 404) {
          return {
            valid: false,
            error: 'This file is not an Excel workbook, or it no longer exists.',
          }
        }
        const body = await response.text().catch(() => '')
        return {
          valid: false,
          error: parseGraphErrorMessage(response.status, response.statusText, body),
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
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

    const lastModified = parseTagDate(metadata.lastModifiedDateTime)
    if (lastModified) {
      result.lastModified = lastModified
    }

    return result
  },
}
