import { createLogger } from '@sim/logger'
import { GoogleSheetsIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
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
 * Fetches the spreadsheet's modifiedTime from the Drive API.
 */
async function fetchSpreadsheetModifiedTime(
  accessToken: string,
  spreadsheetId: string
): Promise<string | undefined> {
  try {
    const url = `${DRIVE_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime&supportsAllDrives=true`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch modifiedTime from Drive API', { status: response.status })
      return undefined
    }

    const data = (await response.json()) as { modifiedTime?: string }
    return data.modifiedTime
  } catch (error) {
    logger.warn('Error fetching modifiedTime from Drive API', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
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
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export const googleSheetsConnector: ConnectorConfig = {
  id: 'google_sheets',
  name: 'Google Sheets',
  description: 'Sync spreadsheet data from Google Sheets into your knowledge base',
  version: '1.0.0',
  icon: GoogleSheetsIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-sheets',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
  },

  configFields: [
    {
      id: 'spreadsheetId',
      title: 'Spreadsheet ID',
      type: 'short-input',
      placeholder: 'e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
      required: true,
      description: 'The ID from the spreadsheet URL: docs.google.com/spreadsheets/d/{ID}/edit',
    },
    {
      id: 'sheetFilter',
      title: 'Sheets to Sync',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All sheets', id: 'all' },
        { label: 'First sheet only', id: 'first' },
      ],
    },
  ],

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

    const [metadata, modifiedTime] = await Promise.all([
      fetchSpreadsheetMetadata(accessToken, spreadsheetId),
      fetchSpreadsheetModifiedTime(accessToken, spreadsheetId),
    ])
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
    let modifiedTime: string | undefined
    try {
      ;[metadata, modifiedTime] = await Promise.all([
        fetchSpreadsheetMetadata(accessToken, spreadsheetId),
        fetchSpreadsheetModifiedTime(accessToken, spreadsheetId),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('404')) {
        logger.info('Spreadsheet not found (possibly deleted)', { spreadsheetId })
        return null
      }
      throw error
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
      modifiedTime
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

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'sheetTitle', displayName: 'Sheet Name', fieldType: 'text' },
    { id: 'rowCount', displayName: 'Row Count', fieldType: 'number' },
    { id: 'columnCount', displayName: 'Column Count', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],

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
