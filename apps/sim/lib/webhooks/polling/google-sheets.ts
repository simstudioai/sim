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
  /** 1-indexed row number of the last row seeded or processed. */
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

      const valueRender = config.valueRenderOption || 'FORMATTED_VALUE'
      const dateTimeRender = config.dateTimeRenderOption || 'SERIAL_NUMBER'

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

      const newRowCount = currentRowCount - config.lastIndexChecked
      const maxRows = config.maxRowsPerPoll || MAX_ROWS_PER_POLL
      const rowsToFetch = Math.min(newRowCount, maxRows)
      const startRow = config.lastIndexChecked + 1
      const endRow = config.lastIndexChecked + rowsToFetch

      // Skip past the header row (and any blank rows above it) so it is never
      // emitted as a data event.
      const adjustedStartRow =
        headerRowIndex > 0 ? Math.max(startRow, headerRowIndex + 1) : startRow

      logger.info(
        `[${requestId}] Found ${newRowCount} new rows for webhook ${webhookId}, processing rows ${adjustedStartRow}-${endRow}`
      )

      // Entire batch is header/blank rows — advance pointer and skip fetch.
      if (adjustedStartRow > endRow) {
        const hasRemainingRows = rowsToFetch < newRowCount
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastIndexChecked: config.lastIndexChecked + rowsToFetch,
            lastModifiedTime: hasRemainingRows
              ? config.lastModifiedTime
              : (currentModifiedTime ?? config.lastModifiedTime),
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
 * Fetches the sheet (A:Z) and returns the row count, auto-detected headers,
 * and the 1-indexed header row number in a single API call.
 *
 * The Sheets API omits trailing empty rows, so `rows.length` equals the last
 * non-empty row in columns A–Z. Header detection scans the first
 * {@link HEADER_SCAN_ROWS} rows for the first non-empty row. Returns
 * `headerRowIndex = 0` when no header is found within the scan window.
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
    const rowNumber = startRowIndex + i

    // Skip empty rows — don't fire a workflow run with no data.
    if (!row || row.length === 0) {
      logger.info(`[${requestId}] Skipping empty row ${rowNumber} for webhook ${webhookData.id}`)
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
