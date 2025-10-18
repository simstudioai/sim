import { createLogger } from '@/lib/logs/console/logger'
import type { ExcelCellValue } from '@/tools/microsoft_excel/types'

const logger = createLogger('MicrosoftExcelUtils')

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
  accessToken: string
): Promise<string> {
  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}?$select=id,webUrl`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      logger.warn('Failed to fetch spreadsheet webUrl, using Graph API URL as fallback', {
        spreadsheetId,
        status: response.status,
      })
      return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`
    }

    const data = await response.json()
    return data.webUrl || `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`
  } catch (error) {
    logger.warn('Error fetching spreadsheet webUrl, using Graph API URL as fallback', {
      spreadsheetId,
      error,
    })
    return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`
  }
}
