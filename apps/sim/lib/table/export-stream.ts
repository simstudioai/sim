import { createLogger } from '@sim/logger'
import { neutralizeCsvFormula } from '@/lib/core/utils/csv'
import { namedRowMapper } from '@/lib/table/cell-format'
import { getColumnId } from '@/lib/table/column-keys'
import { formatCsvCell } from '@/lib/table/export-format'
import { queryRows } from '@/lib/table/rows/service'
import type { TableDefinition, TableExportFormat } from '@/lib/table/types'

const logger = createLogger('TableExportStream')

const EXPORT_BATCH_SIZE = 1000

export function sanitizeExportFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'table'
}

function escapeCsvField(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}

function toCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

export function exportContentType(format: TableExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json'
}

/**
 * Synchronous table export as a byte stream, shared by the first-party and
 * public surfaces so both emit byte-identical files.
 *
 * Rows are paged out as they are read rather than buffered, so a table larger
 * than memory still exports — at the cost of a mid-stream failure being
 * unrecoverable (the response has already started). Large tables should use the
 * background export instead.
 */
export function createTableExportStream(
  table: TableDefinition,
  format: TableExportFormat,
  requestId: string
): ReadableStream<Uint8Array> {
  const columns = table.schema.columns
  // Stored row data is id-keyed; CSV headers and JSON keys are display names, so
  // translate id → name on the way out (export is a name-friendly boundary).
  const toNamedRow = namedRowMapper(columns)

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        if (format === 'csv') {
          controller.enqueue(
            encoder.encode(`${toCsvRow(columns.map((c) => neutralizeCsvFormula(c.name)))}\n`)
          )
        } else {
          controller.enqueue(encoder.encode('['))
        }

        let offset = 0
        let firstJsonRow = true
        while (true) {
          const result = await queryRows(
            table,
            { limit: EXPORT_BATCH_SIZE, offset, includeTotal: false },
            requestId
          )

          for (const row of result.rows) {
            if (format === 'csv') {
              const values = columns.map((c) => formatCsvCell(c, row.data[getColumnId(c)]))
              controller.enqueue(encoder.encode(`${toCsvRow(values)}\n`))
            } else {
              const prefix = firstJsonRow ? '' : ','
              firstJsonRow = false
              controller.enqueue(encoder.encode(prefix + JSON.stringify(toNamedRow(row.data))))
            }
          }

          // A page can be cut by the byte budget before reaching EXPORT_BATCH_SIZE,
          // so a short page does NOT mean the export is done — only a null cursor does.
          if (!result.nextCursor) break
          offset += result.rows.length
        }

        if (format === 'json') controller.enqueue(encoder.encode(']'))
        controller.close()

        logger.info(`[${requestId}] Exported table ${table.id}`, {
          format,
          rowCount: table.rowCount,
        })
      } catch (err) {
        logger.error(`[${requestId}] Export failed for table ${table.id}`, err)
        controller.error(err)
      }
    },
  })
}
