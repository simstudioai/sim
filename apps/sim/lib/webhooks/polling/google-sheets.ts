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

type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'
type DateTimeRenderOption = 'SERIAL_NUMBER' | 'FORMATTED_STRING'

interface GoogleSheetsWebhookConfig {
  spreadsheetId?: string
  manualSpreadsheetId?: string
  sheetName?: string
  manualSheetName?: string
  valueRenderOption?: ValueRenderOption
  dateTimeRenderOption?: DateTimeRenderOption
  lastKnownRowCount?: number
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

      // Fetch current row count via column A
      const currentRowCount = await getDataRowCount(
        accessToken,
        spreadsheetId,
        sheetName,
        requestId,
        logger
      )

      // First poll: seed state, emit nothing
      if (config.lastKnownRowCount === undefined) {
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastKnownRowCount: currentRowCount,
            lastModifiedTime: currentModifiedTime ?? config.lastModifiedTime,
            lastCheckedTimestamp: now.toISOString(),
          },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] First poll for webhook ${webhookId}, seeded row count: ${currentRowCount}`
        )
        return 'success'
      }

      // Rows deleted or unchanged
      if (currentRowCount <= config.lastKnownRowCount) {
        if (currentRowCount < config.lastKnownRowCount) {
          logger.warn(
            `[${requestId}] Row count decreased from ${config.lastKnownRowCount} to ${currentRowCount} for webhook ${webhookId}`
          )
        }
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastKnownRowCount: currentRowCount,
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
      const newRowCount = currentRowCount - config.lastKnownRowCount
      const maxRows = config.maxRowsPerPoll || MAX_ROWS_PER_POLL
      const rowsToFetch = Math.min(newRowCount, maxRows)
      const startRow = config.lastKnownRowCount + 1
      const endRow = config.lastKnownRowCount + rowsToFetch

      logger.info(
        `[${requestId}] Found ${newRowCount} new rows for webhook ${webhookId}, processing rows ${startRow}-${endRow}`
      )

      // Resolve render options
      const valueRender = config.valueRenderOption || 'FORMATTED_VALUE'
      const dateTimeRender = config.dateTimeRenderOption || 'SERIAL_NUMBER'

      const headers = await fetchHeaderRow(
        accessToken,
        spreadsheetId,
        sheetName,
        valueRender,
        dateTimeRender,
        requestId,
        logger
      )

      // Fetch new rows — startRow/endRow are already 1-indexed sheet row numbers
      // because lastKnownRowCount includes the header row
      const newRows = await fetchRowRange(
        accessToken,
        spreadsheetId,
        sheetName,
        startRow,
        endRow,
        valueRender,
        dateTimeRender,
        requestId,
        logger
      )

      const { processedCount, failedCount } = await processRows(
        newRows,
        headers,
        startRow,
        spreadsheetId,
        sheetName,
        config,
        webhookData,
        workflowData,
        requestId,
        logger
      )

      const rowsAdvanced = failedCount > 0 ? 0 : rowsToFetch
      const newLastKnownRowCount = config.lastKnownRowCount + rowsAdvanced
      const hasRemainingOrFailed = rowsAdvanced < newRowCount
      await updateWebhookProviderConfig(
        webhookId,
        {
          lastKnownRowCount: newLastKnownRowCount,
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

async function getDataRowCount(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<number> {
  const encodedSheet = encodeURIComponent(sheetName)
  // Fetch all rows across columns A–Z with majorDimension=ROWS so the API
  // returns one entry per row that has ANY non-empty cell. Rows where column A
  // is empty but other columns have data are included, whereas the previous
  // column-A-only approach silently missed them. The returned array length
  // equals the 1-indexed row number of the last row with data.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedSheet}!A:Z?majorDimension=ROWS&fields=values`

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
      `Failed to fetch row count: ${status} ${response.statusText} - ${JSON.stringify(errorData)}`
    )
  }

  const data = await response.json()
  // values is [[row1col1, row1col2, ...], [row2col1, ...], ...] when majorDimension=ROWS.
  // The Sheets API omits trailing empty rows, so the array length is the last
  // non-empty row index (1-indexed), which is exactly what we need.
  const rows = data.values as string[][] | undefined
  return rows?.length ?? 0
}

async function fetchHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  valueRenderOption: ValueRenderOption,
  dateTimeRenderOption: DateTimeRenderOption,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<string[]> {
  const encodedSheet = encodeURIComponent(sheetName)
  const params = new URLSearchParams({
    fields: 'values',
    valueRenderOption,
    dateTimeRenderOption,
  })
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedSheet}!1:1?${params.toString()}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const status = response.status
    if (status === 403 || status === 429) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        `Sheets API rate limit (${status}) fetching header row — skipping to retry next poll cycle: ${JSON.stringify(errorData)}`
      )
    }
    logger.warn(`[${requestId}] Failed to fetch header row, proceeding without headers`)
    return []
  }

  const data = await response.json()
  return (data.values?.[0] as string[]) ?? []
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
  config: GoogleSheetsWebhookConfig,
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
