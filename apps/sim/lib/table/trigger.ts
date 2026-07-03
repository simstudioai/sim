/**
 * Direct trigger firing for table row events.
 *
 * When rows are inserted or updated in a table, this module looks up any
 * active webhook triggers watching that table and fires workflow executions
 * immediately - no polling or cron involved.
 */

import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { buildNameById, getColumnId, rowDataIdToName } from '@/lib/table/column-keys'
import type { RowData, TableRow, TableSchema } from '@/lib/table/types'
import { readCanonicalTriggerValue } from '@/lib/webhooks/polling/canonical'

const logger = createLogger('TableTrigger')

type EventType = 'insert' | 'update'

interface TableTriggerPayload {
  row: Record<string, unknown> | null
  rawRow: Record<string, unknown>
  previousRow: Record<string, unknown> | null
  changedColumns: string[]
  rowId: string
  headers: string[]
  tableId: string
  tableName: string
  timestamp: string
}

interface WebhookConfig {
  tableId?: string
  tableSelector?: string
  manualTableId?: string
  eventType?: string
  watchColumns?: string | string[]
  includeHeaders?: boolean
}

/**
 * Fires workflow triggers for table row changes.
 *
 * This is fire-and-forget - errors are logged but never thrown.
 * Call with `void fireTableTrigger(...)` to avoid blocking the caller.
 *
 * @param eventType - 'insert' for new rows, 'update' for changed rows
 * @param oldRows - Map of row ID to previous data. Pass null for inserts.
 */
export async function fireTableTrigger(
  tableId: string,
  tableName: string,
  eventType: EventType,
  rows: TableRow[],
  oldRows: Map<string, RowData> | null,
  schema: TableSchema,
  requestId: string
): Promise<void> {
  try {
    // Lazy: the webhook utils/processor pull in the executor + blocks stack.
    // Eager imports would force every `lib/table/service` consumer (e.g. the
    // dispatcher) to pay that cold-start even when no trigger fires.
    const { fetchActiveWebhooks } = await import('@/lib/webhooks/polling/utils')
    const webhooks = await fetchActiveWebhooks('table')
    if (webhooks.length === 0) return

    const headers = schema.columns.map((c) => c.name)
    // The webhook payload is name-keyed (the workflow author references columns
    // by name); stored row data is id-keyed, so translate on the way out.
    const nameById = buildNameById(schema)

    // Filter to webhooks watching this table with a matching event type
    const matching = webhooks.filter((entry) => {
      const config = entry.webhook.providerConfig as WebhookConfig | null
      // Canonical key `tableId` first; `tableSelector`/`manualTableId` are a transitional
      // basic-first fallback for configs deployed before the canonical key was written.
      const configTableId = readCanonicalTriggerValue(
        config?.tableId,
        config?.tableSelector,
        config?.manualTableId
      )
      if (configTableId !== tableId) return false

      const configEventType = config?.eventType ?? 'insert'
      return configEventType === eventType
    })

    if (matching.length === 0) return

    const { processPolledWebhookEvent } = await import('@/lib/webhooks/processor')

    logger.info(
      `[${requestId}] Firing ${matching.length} trigger(s) for ${rows.length} ${eventType} event(s) in table ${tableId}`
    )

    for (const { webhook: webhookData, workflow: workflowData } of matching) {
      const config = webhookData.providerConfig as WebhookConfig | null
      const watchColumns = parseWatchColumns(config?.watchColumns)
      const includeHeaders = config?.includeHeaders !== false

      for (const row of rows) {
        const previousIdData = oldRows?.get(row.id) ?? null
        // Translate id-keyed stored data → name-keyed for the external payload.
        const rawRow = rowDataIdToName(row.data, nameById)
        const previousRow = previousIdData ? rowDataIdToName(previousIdData, nameById) : null
        const changedColumns = previousIdData
          ? detectChangedColumns(previousIdData, row.data)
              .map((id) => nameById.get(id))
              .filter((name): name is string => name !== undefined)
          : []

        // For updates with watch columns, skip rows where no watched column changed
        if (eventType === 'update' && watchColumns.length > 0) {
          const hasWatchedChange = changedColumns.some((col) => watchColumns.includes(col))
          if (!hasWatchedChange) continue
        }

        // Build mapped row if includeHeaders is enabled
        let mappedRow: Record<string, unknown> | null = null
        if (includeHeaders && headers.length > 0) {
          mappedRow = {}
          for (const col of schema.columns) {
            mappedRow[col.name] = row.data[getColumnId(col)] ?? null
          }
        }

        const payload: TableTriggerPayload = {
          row: mappedRow,
          rawRow,
          previousRow,
          changedColumns,
          rowId: row.id,
          headers,
          tableId,
          tableName,
          timestamp: new Date().toISOString(),
        }

        const eventRequestId = generateShortId()

        try {
          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            eventRequestId
          )

          if (!result.success) {
            logger.error(
              `[${eventRequestId}] Failed to fire table trigger for row ${row.id}:`,
              result.statusCode,
              result.error
            )
          }
        } catch (error) {
          logger.error(`[${eventRequestId}] Error firing table trigger for row ${row.id}:`, error)
        }
      }
    }
  } catch (error) {
    logger.error(`[${requestId}] Error in fireTableTrigger:`, error)
  }
}

function parseWatchColumns(watchColumns: string | string[] | undefined): string[] {
  if (!watchColumns) return []
  if (Array.isArray(watchColumns)) return watchColumns.filter(Boolean)
  return watchColumns
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
}

function detectChangedColumns(oldData: RowData, newData: RowData): string[] {
  const changed: string[] = []
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)])

  for (const key of allKeys) {
    if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
      changed.push(key)
    }
  }

  return changed
}
