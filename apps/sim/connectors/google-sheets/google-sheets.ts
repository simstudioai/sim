import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { googleSheetsConnectorMeta } from '@/connectors/google-sheets/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('GoogleSheetsConnector')

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files'
const MAX_ROWS = 10000
const CONCURRENCY = 3

interface SheetProperties {
  sheetId: number
  title: string
  index: number
  gridProperties?: {
    rowCount?: number
    columnCount?: number
  }
}

interface SpreadsheetMetadata {
  spreadsheetId: string
  properties: {
    title: string
    locale?: string
  }
  sheets: { properties: SheetProperties }[]
}

/**
 * Formats sheet data into an LLM-friendly text representation.
 * Each row is labeled with its index and columns are identified by header names.
 */
function formatSheetContent(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return ''

  const lines: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    lines.push(`Row ${i + 1}:`)
    for (let j = 0; j < headers.length; j++) {
      const value = j < row.length ? row[j] : ''
      lines.push(`  ${headers[j]}: ${value}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

/**
 * Fetches all values from a single sheet tab.
 */
async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[][]> {
  const range = `'${sheetTitle.replace(/'/g, "''")}'!A1:ZZ${MAX_ROWS}`
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

  const data = await response.json()
  return (data.values || []) as string[][]
}

/**
 * Fetches spreadsheet metadata (title, sheet names, grid properties).
 */
async function fetchSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,properties.locale,sheets.properties`

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
 * accessible by ID for 30 days before permanent deletion ("other users can
 * still access the file in the owner's trash until it's permanently deleted"),
 * so `spreadsheets.get` keeps succeeding and every tab keeps appearing in the
 * listing. Since KB deletion reconciliation only purges stored documents that
 * are absent from a full listing, a trashed spreadsheet's tabs would otherwise
 * live in the knowledge base forever — and once the 30 days elapse the Sheets
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

/**
 * Converts a single sheet tab into an ExternalDocument.
 */
async function sheetToDocument(
  accessToken: string,
  spreadsheetId: string,
  spreadsheetTitle: string,
  sheet: SheetProperties,
  modifiedTime?: string
): Promise<ExternalDocument | null> {
  try {
    const values = await fetchSheetValues(accessToken, spreadsheetId, sheet.title)

    if (values.length === 0) {
      logger.info(`Skipping empty sheet: ${sheet.title}`)
      return null
    }

    const headers = values[0].map((h, idx) =>
      typeof h === 'string' && h.trim() ? h.trim() : `Column ${idx + 1}`
    )
    const dataRows = values.slice(1)

    if (dataRows.length === 0) {
      logger.info(`Skipping header-only sheet: ${sheet.title}`)
      return null
    }

    const content = formatSheetContent(headers, dataRows)
    if (!content.trim()) {
      return null
    }

    const rowCount = dataRows.length

    return {
      externalId: `${spreadsheetId}__sheet__${sheet.sheetId}`,
      title: `${spreadsheetTitle} - ${sheet.title}`,
      content,
      mimeType: 'text/plain',
      sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheet.sheetId}`,
      contentHash: `gsheets:${spreadsheetId}:${sheet.sheetId}:${modifiedTime ?? ''}`,
      metadata: {
        spreadsheetId,
        spreadsheetTitle,
        sheetTitle: sheet.title,
        sheetId: sheet.sheetId,
        rowCount,
        columnCount: headers.length,
        ...(modifiedTime ? { modifiedTime } : {}),
      },
    }
  } catch (error) {
    logger.warn(`Failed to extract content from sheet: ${sheet.title}`, {
      error: toError(error).message,
    })
    return null
  }
}

export const googleSheetsConnector: ConnectorConfig = {
  ...googleSheetsConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const spreadsheetId = (sourceConfig.spreadsheetId as string)?.trim()
    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID is required')
    }

    logger.info('Fetching spreadsheet metadata', { spreadsheetId })

    const [metadata, driveMetadata] = await Promise.all([
      fetchSpreadsheetMetadata(accessToken, spreadsheetId),
      fetchDriveFileMetadata(accessToken, spreadsheetId),
    ])

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

    let sheets = metadata.sheets.map((s) => s.properties)
    if (sheetFilter === 'first' && sheets.length > 0) {
      sheets = [sheets[0]]
    }

    logger.info('Processing sheets', {
      spreadsheetTitle: metadata.properties.title,
      sheetCount: sheets.length,
    })

    const documents: ExternalDocument[] = sheets.map((sheet) => ({
      externalId: `${spreadsheetId}__sheet__${sheet.sheetId}`,
      title: `${metadata.properties.title} - ${sheet.title}`,
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain',
      sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheet.sheetId}`,
      contentHash: `gsheets:${spreadsheetId}:${sheet.sheetId}:${modifiedTime ?? ''}`,
      metadata: {
        spreadsheetId,
        spreadsheetTitle: metadata.properties.title,
        sheetTitle: sheet.title,
        sheetId: sheet.sheetId,
        rowCount: sheet.gridProperties?.rowCount,
        columnCount: sheet.gridProperties?.columnCount,
        ...(modifiedTime ? { modifiedTime } : {}),
      },
    }))

    return {
      documents,
      hasMore: false,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const parts = externalId.split('__sheet__')
    if (parts.length !== 2) {
      logger.warn('Invalid external ID format', { externalId })
      return null
    }

    const spreadsheetId = parts[0]
    const sheetId = Number(parts[1])

    if (Number.isNaN(sheetId)) {
      logger.warn('Invalid sheet ID in external ID', { externalId })
      return null
    }

    let metadata: SpreadsheetMetadata
    let driveMetadata: DriveFileMetadata
    try {
      ;[metadata, driveMetadata] = await Promise.all([
        fetchSpreadsheetMetadata(accessToken, spreadsheetId),
        fetchDriveFileMetadata(accessToken, spreadsheetId),
      ])
    } catch (error) {
      const message = toError(error).message
      if (message.includes('404')) {
        logger.info('Spreadsheet not found (possibly deleted)', { spreadsheetId })
        return null
      }
      throw error
    }

    /** Mirrors the listing: a trashed spreadsheet is still readable but no longer current. */
    if (isTrashedDriveFile(driveMetadata)) {
      logger.info('Spreadsheet is in the Drive trash', { spreadsheetId })
      return null
    }

    const sheetEntry = metadata.sheets.find((s) => s.properties.sheetId === sheetId)

    if (!sheetEntry) {
      logger.info('Sheet not found in spreadsheet', { spreadsheetId, sheetId })
      return null
    }

    const doc = await sheetToDocument(
      accessToken,
      spreadsheetId,
      metadata.properties.title,
      sheetEntry.properties,
      driveMetadata.modifiedTime
    )
    if (!doc) return null
    return { ...doc, contentDeferred: false }
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
