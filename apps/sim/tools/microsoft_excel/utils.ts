import { createLogger } from '@sim/logger'
import { validatePathSegment } from '@/lib/core/security/input-validation'
import type { ExcelCellValue } from '@/tools/microsoft_excel/types'

const logger = createLogger('MicrosoftExcelUtils')

/**
 * Extract a developer-readable message from a parsed Microsoft Graph error body.
 * Graph errors follow the documented shape:
 *   { error: { code, message, innerError: { code, message, ... }, details: [...] } }
 * See https://learn.microsoft.com/en-us/graph/errors
 *
 * Walks the nested innerError chain (capped at depth 5) and appends details[].message.
 * Returns undefined when no message-like field is present so callers can fall back.
 */
export function parseGraphErrorFromData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined

  const root = (
    data as {
      error?: {
        code?: unknown
        message?: unknown
        innerError?: unknown
        innererror?: unknown
        details?: unknown
      }
    }
  ).error
  if (root && typeof root === 'object') {
    const messages: string[] = []
    if (typeof root.message === 'string' && root.message.trim()) {
      messages.push(root.message.trim())
    }

    // Walk the (possibly nested) innerError chain. Spec uses `innererror`
    // but Graph commonly returns `innerError` — accept both.
    let inner: any = (root as any).innererror ?? (root as any).innerError
    let depth = 0
    while (inner && depth < 5) {
      if (typeof inner.message === 'string' && inner.message.trim()) {
        const msg = inner.message.trim()
        if (!messages.includes(msg)) messages.push(msg)
      }
      inner = inner.innererror ?? inner.innerError
      depth++
    }

    if (Array.isArray((root as any).details)) {
      for (const detail of (root as any).details) {
        if (detail && typeof detail.message === 'string' && detail.message.trim()) {
          const msg = detail.message.trim()
          if (!messages.includes(msg)) messages.push(msg)
        }
      }
    }

    if (messages.length > 0) return messages.join(' — ')

    if (typeof root.code === 'string' && root.code.trim()) {
      return root.code.trim()
    }
  }

  const topMessage = (data as { message?: unknown }).message
  if (typeof topMessage === 'string' && topMessage.trim()) {
    return topMessage.trim()
  }

  return undefined
}

/**
 * Parse a Microsoft Graph error response body into a string message.
 * Used by API routes that have a Response object rather than parsed data.
 */
export function parseGraphErrorMessage(
  status: number,
  statusText: string,
  errorText: string
): string {
  try {
    const data = JSON.parse(errorText)
    const message = parseGraphErrorFromData(data)
    if (message) {
      // If the only thing we found was the bare error code, append status for context.
      const root = data?.error
      if (
        root &&
        message === root.code?.trim?.() &&
        !(typeof root.message === 'string' && root.message.trim())
      ) {
        return `${message} (${status} ${statusText})`
      }
      return message
    }
  } catch {
    if (errorText?.trim()) return errorText.trim()
  }

  return statusText ? `${status} ${statusText}` : `Microsoft Graph request failed (${status})`
}

/**
 * Read an error response body and produce a developer-readable message.
 * Safely handles non-JSON bodies and read failures. Used by internal API routes.
 */
export async function extractGraphError(response: Response): Promise<string> {
  const errorText = await response.text().catch(() => '')
  return parseGraphErrorMessage(response.status, response.statusText, errorText)
}

/** Pattern for Microsoft Graph item/drive IDs: alphanumeric, hyphens, underscores, and ! (for SharePoint b!<base64> format) */
export const GRAPH_ID_PATTERN = /^[a-zA-Z0-9!_-]+$/

/**
 * Returns the Graph API base path for an Excel item.
 * When driveId is provided, uses /drives/{driveId}/items/{itemId} (SharePoint/shared drives).
 * When driveId is omitted, uses /me/drive/items/{itemId} (personal OneDrive).
 */
export function getItemBasePath(spreadsheetId: string, driveId?: string): string {
  const spreadsheetValidation = validatePathSegment(spreadsheetId, {
    paramName: 'spreadsheetId',
    customPattern: GRAPH_ID_PATTERN,
  })
  if (!spreadsheetValidation.isValid) {
    throw new Error(spreadsheetValidation.error)
  }

  if (driveId) {
    const driveValidation = validatePathSegment(driveId, {
      paramName: 'driveId',
      customPattern: GRAPH_ID_PATTERN,
    })
    if (!driveValidation.isValid) {
      throw new Error(driveValidation.error)
    }
    return `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${spreadsheetId}`
  }
  return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`
}

export function trimTrailingEmptyRowsAndColumns(matrix: ExcelCellValue[][]): ExcelCellValue[][] {
  if (!Array.isArray(matrix) || matrix.length === 0) return []

  const isEmptyValue = (v: ExcelCellValue) => v === null || v === ''

  // Determine last non-empty row
  let lastNonEmptyRowIndex = -1
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || []
    const hasData = row.some((cell: ExcelCellValue) => !isEmptyValue(cell))
    if (hasData) lastNonEmptyRowIndex = r
  }

  if (lastNonEmptyRowIndex === -1) return []

  const trimmedRows = matrix.slice(0, lastNonEmptyRowIndex + 1)

  // Determine last non-empty column across trimmed rows
  let lastNonEmptyColIndex = -1
  for (let r = 0; r < trimmedRows.length; r++) {
    const row = trimmedRows[r] || []
    for (let c = 0; c < row.length; c++) {
      if (!isEmptyValue(row[c])) {
        if (c > lastNonEmptyColIndex) lastNonEmptyColIndex = c
      }
    }
  }

  if (lastNonEmptyColIndex === -1) return []

  return trimmedRows.map((row) => (row || []).slice(0, lastNonEmptyColIndex + 1))
}

/**
 * Fetches the browser-accessible web URL for an Excel spreadsheet.
 * This URL can be opened in a browser if the user is logged into OneDrive/Microsoft,
 * unlike the Graph API URL which requires an access token.
 */
export async function getSpreadsheetWebUrl(
  spreadsheetId: string,
  accessToken: string,
  driveId?: string
): Promise<string> {
  const basePath = getItemBasePath(spreadsheetId, driveId)
  try {
    const response = await fetch(`${basePath}?$select=id,webUrl`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch spreadsheet webUrl, using Graph API URL as fallback', {
        spreadsheetId,
        status: response.status,
      })
      return basePath
    }

    const data = await response.json()
    return data.webUrl || basePath
  } catch (error) {
    logger.warn('Error fetching spreadsheet webUrl, using Graph API URL as fallback', {
      spreadsheetId,
      error,
    })
    return basePath
  }
}
