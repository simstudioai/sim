import { pollingIdempotency } from '@/lib/core/idempotency/service'
import type { PollingProviderHandler, PollWebhookContext } from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  resolveOAuthCredential,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'

const MAX_ROWS_PER_POLL = 100

/** Maximum number of leading rows to scan when auto-detecting the header row. */
const HEADER_SCAN_ROWS = 10

type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'
type DateTimeRenderOption = 'SERIAL_NUMBER' | 'FORMATTED_STRING'

interface GoogleSheetsWebhookConfig {
  spreadsheetId?: string
  manualSpreadsheetId?: string
  sheetName?: string
  manualSheetName?: string
  valueRenderOption?: ValueRenderOption
  dateTimeRenderOption?: DateTimeRenderOption
  /**
   * The 1-indexed row number of the last row we have seeded or processed.
   * New rows are emitted starting from lastIndexChecked + 1.
   */
  lastIndexChecked?: number
  lastModifiedTime?: string
  lastCheckedTimestamp?: string
  maxRowsPerPoll?: number
}

export interface GoogleSheetsWebhookPayload {
  row: Record<string, string> | null
  rawRow: string[]
  headers: string[]
  rowNumber: number
  spreadsheetId: string
  sheetName: string
  timestamp: string
}

export const googleSheetsPollingHandler: PollingProviderHandler = {
  provider: 'google-sheets',
  label: 'Google Sheets',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const accessToken = await resolveOAuthCredential(
        webhookData,
        'google-sheets',
        requestId,
        logger
      )

      const config = webhookData.providerConfig as unknown as GoogleSheetsWebhookConfig
      const spreadsheetId = config.spreadsheetId || config.manualSpreadsheetId
      const sheetName = config.sheetName || config.manualSheetName
      const now = new Date()

      if (!spreadsheetId || !sheetName) {
        logger.error(`[${requestId}] Missing spreadsheetId or sheetName for webhook ${webhookId}`)
        await markWebhookFailed(webhookId, logger)
        return 'failure'
      }

      // Pre-check: use Drive API to see if the file was modified since last poll
      const { unchanged: skipPoll, currentModifiedTime } = await isDriveFileUnchanged(
        accessToken,
        spreadsheetId,
        config.lastModifiedTime,
        requestId,
        logger
      )

      if (skipPoll) {
        await updateWebhookProviderConfig(
          webhookId,
          { lastCheckedTimestamp: now.toISOString() },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] Sheet not modified since last poll for webhook ${webhookId}`)
        return 'success'
      }

      // Resolve render options before the sheet fetch so they apply to both
      // row counting and header detection in the same API call.
      const valueRender = config.valueRenderOption || 'FORMATTED_VALUE'
      const dateTimeRender = config.dateTimeRenderOption || 'SERIAL_NUMBER'

      // Single API call: get current row count AND auto-detect the header row.
      // Combining these avoids a second round-trip when new rows are present.
      const {
        rowCount: currentRowCount,
        headers,
        headerRowIndex,
      } = await fetchSheetState(
        accessToken,
        spreadsheetId,
        sheetName,
        valueRender,
        dateTimeRender,
        requestId,
        logger
      )

      // First poll: seed state, emit nothing
      if (config.lastIndexChecked === undefined) {
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastIndexChecked: currentRowCount,
            lastModifiedTime: currentModifiedTime ?? config.lastModifiedTime,
            lastCheckedTimestamp: now.toISOString(),
          },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] First poll for webhook ${webhookId}, seeded row index: ${currentRowCount}`
        )
        return 'success'
      }

      // Rows deleted or unchanged — update pointer to current position to avoid
      // re-processing if rows are later re-added at a lower index
      if (currentRowCount <= config.lastIndexChecked) {
        if (currentRowCount < config.lastIndexChecked) {
          logger.warn(
            `[${requestId}] Row count decreased from ${config.lastIndexChecked} to ${currentRowCount} for webhook ${webhookId}`
          )
        }
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastIndexChecked: currentRowCount,
            lastModifiedTime: currentModifiedTime ?? config.lastModifiedTime,
            lastCheckedTimestamp: now.toISOString(),
          },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] No new rows for webhook ${webhookId}`)
        return 'success'
      }

      // New rows detected
      const newRowCount = currentRowCount - config.lastIndexChecked
      const maxRows = config.maxRowsPerPoll || MAX_ROWS_PER_POLL
      const rowsToFetch = Math.min(newRowCount, maxRows)
      const startRow = config.lastIndexChecked + 1
      const endRow = config.lastIndexChecked + rowsToFetch

      // If the header row (or blank rows above it) falls within the current
      // fetch window, skip past them so the header is never emitted as a data
      // event. This happens when lastIndexChecked was seeded from an empty sheet
      // and the user subsequently added a header row + data rows together.
      const adjustedStartRow =
        headerRowIndex > 0 ? Math.max(startRow, headerRowIndex + 1) : startRow

      logger.info(
        `[${requestId}] Found ${newRowCount} new rows for webhook ${webhookId}, processing rows ${adjustedStartRow}-${endRow}`
      )

      // All rows in this batch are header or blank rows — advance the pointer
      // and skip data fetching entirely.
      if (adjustedStartRow > endRow) {
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastIndexChecked: config.lastIndexChecked + rowsToFetch,
            lastModifiedTime: currentModifiedTime ?? config.lastModifiedTime,
            lastCheckedTimestamp: now.toISOString(),
          },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] Batch ${startRow}-${endRow} contained only header/blank rows for webhook ${webhookId}, advancing pointer`
        )
        return 'success'
      }

      const newRows = await fetchRowRange(
        accessToken,
        spreadsheetId,
        sheetName,
        adjustedStartRow,
        endRow,
        valueRender,
        dateTimeRender,
        requestId,
        logger
      )

      const { processedCount, failedCount } = await processRows(
        newRows,
        headers,
        adjustedStartRow,
        spreadsheetId,
        sheetName,
        webhookData,
        workflowData,
        requestId,
        logger
      )

      const rowsAdvanced = failedCount > 0 ? 0 : rowsToFetch
      const newLastIndexChecked = config.lastIndexChecked + rowsAdvanced
      const hasRemainingOrFailed = rowsAdvanced < newRowCount
      await updateWebhookProviderConfig(
        webhookId,
        {
          lastIndexChecked: newLastIndexChecked,
          lastModifiedTime: hasRemainingOrFailed
            ? config.lastModifiedTime
            : (currentModifiedTime ?? config.lastModifiedTime),
          lastCheckedTimestamp: now.toISOString(),
        },
        logger
      )

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(
          `[${requestId}] All ${failedCount} rows failed to process for webhook ${webhookId}`
        )
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `[${requestId}] Successfully processed ${processedCount} rows for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      logger.error(`[${requestId}] Error processing Google Sheets webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function isDriveFileUnchanged(
  accessToken: string,
  spreadsheetId: string,
  lastModifiedTime: string | undefined,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ unchanged: boolean; currentModifiedTime?: string }> {
  try {
    const currentModifiedTime = await getDriveFileModifiedTime(accessToken, spreadsheetId, logger)
    if (!lastModifiedTime || !currentModifiedTime) {
      return { unchanged: false, currentModifiedTime }
    }
    return { unchanged: currentModifiedTime === lastModifiedTime, currentModifiedTime }
  } catch (error) {
    logger.warn(`[${requestId}] Drive modifiedTime check failed, proceeding with Sheets API`)
    return { unchanged: false }
  }
}

async function getDriveFileModifiedTime(
  accessToken: string,
  fileId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<string | undefined> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!response.ok) return undefined
    const data = await response.json()
    return data.modifiedTime as string | undefined
  } catch {
    return undefined
  }
}

/**
 * Fetches the full sheet in a single API call and returns both the current row
 * count and the auto-detected headers.
 *
 * Row count: the Sheets API omits trailing empty rows, so the length of the
 * returned values array equals the 1-indexed number of the last row with data.
 *
 * Header detection: scans the first {@link HEADER_SCAN_ROWS} rows and returns
 * the first non-empty row as headers. This correctly handles sheets where
 * headers are not in row 1 (e.g. blank rows or a title row above the column
 * headers). `headerRowIndex` is the 1-indexed row number of that row, or 0 if
 * no non-empty row was found within the scan window.
 *
 * Combining both into one call avoids the extra round-trip that a separate
 * header-detection fetch would require on every cycle where new rows exist.
 */
async function fetchSheetState(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  valueRenderOption: ValueRenderOption,
  dateTimeRenderOption: DateTimeRenderOption,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ rowCount: number; headers: string[]; headerRowIndex: number }> {
  const encodedSheet = encodeURIComponent(sheetName)
  // Fetch all rows across columns A–Z with majorDimension=ROWS so the API
  // returns one entry per row that has ANY non-empty cell. Rows where column A
  // is empty but other columns have data are included. The array length equals
  // the 1-indexed row number of the last row with data (trailing empty rows are
  // omitted by the Sheets API). Leading empty rows within the range are included
  // as [] so values[i] reliably corresponds to sheet row i+1.
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    fields: 'values',
    valueRenderOption,
    dateTimeRenderOption,
  })
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedSheet}!A:Z?${params.toString()}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const status = response.status
    const errorData = await response.json().catch(() => ({}))

    if (status === 403 || status === 429) {
      throw new Error(
        `Sheets API rate limit (${status}) — skipping to retry next poll cycle: ${JSON.stringify(errorData)}`
      )
    }

    throw new Error(
      `Failed to fetch sheet state: ${status} ${response.statusText} - ${JSON.stringify(errorData)}`
    )
  }

  const data = await response.json()
  const rows = (data.values as string[][] | undefined) ?? []
  const rowCount = rows.length

  // Find the first non-empty row within the header scan window
  let headers: string[] = []
  let headerRowIndex = 0
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const row = rows[i]
    if (row?.some((cell) => cell !== '')) {
      headers = row
      headerRowIndex = i + 1
      break
    }
  }

  return { rowCount, headers, headerRowIndex }
}

async function fetchRowRange(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  startRow: number,
  endRow: number,
  valueRenderOption: ValueRenderOption,
  dateTimeRenderOption: DateTimeRenderOption,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<string[][]> {
  const encodedSheet = encodeURIComponent(sheetName)
  const params = new URLSearchParams({
    fields: 'values',
    valueRenderOption,
    dateTimeRenderOption,
  })
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedSheet}!${startRow}:${endRow}?${params.toString()}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const status = response.status
    const errorData = await response.json().catch(() => ({}))

    if (status === 403 || status === 429) {
      throw new Error(
        `Sheets API rate limit (${status}) — skipping to retry next poll cycle: ${JSON.stringify(errorData)}`
      )
    }

    throw new Error(
      `Failed to fetch rows ${startRow}-${endRow}: ${status} ${response.statusText} - ${JSON.stringify(errorData)}`
    )
  }

  const data = await response.json()
  return (data.values as string[][]) ?? []
}

async function processRows(
  rows: string[][],
  headers: string[],
  startRowIndex: number,
  spreadsheetId: string,
  sheetName: string,
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ processedCount: number; failedCount: number }> {
  let processedCount = 0
  let failedCount = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = startRowIndex + i // startRowIndex is already the 1-indexed sheet row

    // The Sheets API returns [] for empty rows within a fixed range. Skip them
    // rather than firing a workflow run with no meaningful data.
    if (!row || row.length === 0) {
      logger.info(`[${requestId}] Skipping empty row ${rowNumber} for webhook ${webhookData.id}`)
      processedCount++
      continue
    }

    try {
      await pollingIdempotency.executeWithIdempotency(
        'google-sheets',
        `${webhookData.id}:${spreadsheetId}:${sheetName}:row${rowNumber}`,
        async () => {
          let mappedRow: Record<string, string> | null = null
          if (headers.length > 0) {
            mappedRow = {}
            for (let j = 0; j < headers.length; j++) {
              mappedRow[headers[j] || `Column ${j + 1}`] = row[j] ?? ''
            }
            for (let j = headers.length; j < row.length; j++) {
              mappedRow[`Column ${j + 1}`] = row[j] ?? ''
            }
          }

          const payload: GoogleSheetsWebhookPayload = {
            row: mappedRow,
            rawRow: row,
            headers,
            rowNumber,
            spreadsheetId,
            sheetName,
            timestamp: new Date().toISOString(),
          }

          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            requestId
          )

          if (!result.success) {
            logger.error(
              `[${requestId}] Failed to process webhook for row ${rowNumber}:`,
              result.statusCode,
              result.error
            )
            throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
          }

          return { rowNumber, processed: true }
        }
      )

      logger.info(
        `[${requestId}] Successfully processed row ${rowNumber} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing row ${rowNumber}:`, errorMessage)
      failedCount++
    }
  }

  return { processedCount, failedCount }
}
