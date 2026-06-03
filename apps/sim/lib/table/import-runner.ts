import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  buildAutoMapping,
  CSV_MAX_BATCH_SIZE,
  CSV_SCHEMA_SAMPLE_SIZE,
  type CsvHeaderMapping,
  coerceRowsForTable,
  createCsvParser,
  inferColumnType,
  inferSchemaFromCsv,
  sanitizeName,
  type TableSchema,
  validateMapping,
} from '@/lib/table'
import { appendTableEvent } from '@/lib/table/events'
import {
  addImportColumns,
  bulkInsertImportBatch,
  deleteAllTableRows,
  getTableById,
  markImportFailed,
  markImportReady,
  setTableSchemaForImport,
  updateImportProgress,
} from '@/lib/table/service'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableImportRunner')

/** Emit a progress event / DB update at most every this many rows. */
const PROGRESS_INTERVAL_ROWS = 5000

/** `create` infers a schema for a new table; `append`/`replace` map onto an existing one. */
export type TableImportMode = 'create' | 'append' | 'replace'

export interface TableImportPayload {
  importId: string
  tableId: string
  workspaceId: string
  userId: string
  /** Storage key of the already-uploaded CSV/TSV file. */
  fileKey: string
  fileName: string
  delimiter: ',' | '\t'
  mode: TableImportMode
  /** (append/replace) Explicit CSV-header → column mapping; auto-mapped when omitted. */
  mapping?: CsvHeaderMapping
  /** (append/replace) CSV headers to auto-create as new columns (types inferred from the sample). */
  createColumns?: string[]
}

/**
 * Background worker for large CSV/TSV imports. Runs detached on the web container
 * (see the kickoff routes). Streams the stored file through `createCsvParser`, resolves
 * the target schema + header→column mapping from the first sample (inferring a new schema
 * for `create`, mapping onto the existing schema for `append`/`replace`), then bulk-inserts
 * in committed batches — **no rollback**: committed batches persist even if a later batch
 * fails. Progress and the terminal state are surfaced via the table-events SSE stream.
 */
export async function runTableImport(payload: TableImportPayload): Promise<void> {
  const { importId, tableId, workspaceId, userId, fileKey, fileName, delimiter, mode } = payload
  const requestId = generateId().slice(0, 8)

  try {
    const loaded = await getTableById(tableId, { includeArchived: true })
    if (!loaded) throw new Error(`Import target table ${tableId} not found`)
    const table = loaded

    const buffer = await downloadFile({ key: fileKey, context: 'workspace' })

    // Delete only after the download succeeds — otherwise a failed download would wipe the
    // table with nothing to replace it with.
    if (mode === 'replace') await deleteAllTableRows(tableId)

    // Estimate total data rows by counting line breaks (minus the header) for a
    // determinate progress bar. It's an estimate — quoted newlines and blank lines
    // make it imprecise — so the client caps the bar below 100% until the terminal
    // `ready` event lands. Cheap: one O(bytes) pass over the already-buffered file.
    let newlineCount = 0
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0x0a) newlineCount++
    }
    const estimatedTotal = Math.max(0, newlineCount - 1)

    // Publish the estimated total up front so the client shows a determinate bar at 0%
    // immediately, instead of "0 rows and counting" until the first batch lands.
    void appendTableEvent({
      kind: 'import',
      tableId,
      importId,
      status: 'importing',
      progress: 0,
      total: estimatedTotal,
    })

    const parser = createCsvParser(delimiter)
    // `.pipe` doesn't forward source errors; forward so the iterator throws.
    const source = Readable.from(buffer)
    source.on('error', (err) => parser.destroy(err))
    source.pipe(parser)

    let schema: TableSchema | null = null
    let headerToColumn: Map<string, string> | null = null
    let inserted = 0
    let lastReported = 0
    const sample: Record<string, unknown>[] = []
    let batch: Record<string, unknown>[] = []

    /**
     * Resolve the schema + header→column mapping from the buffered sample (runs once).
     * `create` infers a fresh schema and overwrites the placeholder; `append`/`replace`
     * map onto the existing schema, optionally auto-creating `createColumns` first.
     */
    const resolveSetup = async () => {
      const headers = Object.keys(sample[0])

      if (mode === 'create') {
        const inferred = inferSchemaFromCsv(headers, sample)
        schema = { columns: inferred.columns.map(normalizeColumn) }
        headerToColumn = inferred.headerToColumn
        await setTableSchemaForImport(tableId, schema)
        return
      }

      // append / replace into an existing table.
      let targetSchema = table.schema
      let effectiveMapping: CsvHeaderMapping =
        payload.mapping ?? buildAutoMapping(headers, table.schema)

      if (payload.createColumns && payload.createColumns.length > 0) {
        const unknown = payload.createColumns.filter((h) => !headers.includes(h))
        if (unknown.length > 0) {
          throw new Error(`Columns to create are not in the CSV: ${unknown.join(', ')}`)
        }
        const usedNames = new Set(table.schema.columns.map((c) => c.name.toLowerCase()))
        const additions: { name: string; type: string }[] = []
        const updatedMapping: CsvHeaderMapping = { ...effectiveMapping }
        for (const header of payload.createColumns) {
          const base = sanitizeName(header)
          let columnName = base
          let suffix = 2
          while (usedNames.has(columnName.toLowerCase())) {
            columnName = `${base}_${suffix}`
            suffix++
          }
          usedNames.add(columnName.toLowerCase())
          additions.push({ name: columnName, type: inferColumnType(sample.map((r) => r[header])) })
          updatedMapping[header] = columnName
        }
        const updated = await addImportColumns(table, additions, requestId)
        targetSchema = updated.schema
        effectiveMapping = updatedMapping
      }

      const validation = validateMapping({
        csvHeaders: headers,
        mapping: effectiveMapping,
        tableSchema: targetSchema,
      })
      schema = targetSchema
      headerToColumn = validation.effectiveMap
    }

    const flush = async (rows: Record<string, unknown>[]) => {
      if (rows.length === 0 || !schema || !headerToColumn) return
      const coerced = coerceRowsForTable(rows, schema, headerToColumn)
      inserted += await bulkInsertImportBatch(
        { tableId, workspaceId, userId, rows: coerced, startPosition: inserted },
        { ...table, schema },
        requestId
      )
      if (inserted - lastReported >= PROGRESS_INTERVAL_ROWS) {
        lastReported = inserted
        await updateImportProgress(tableId, inserted)
        void appendTableEvent({
          kind: 'import',
          tableId,
          importId,
          status: 'importing',
          progress: inserted,
          total: estimatedTotal,
        })
      }
    }

    let ready = false
    for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
      if (!ready) {
        sample.push(record)
        if (sample.length >= CSV_SCHEMA_SAMPLE_SIZE) {
          await resolveSetup()
          await flush(sample)
          ready = true
        }
        continue
      }
      batch.push(record)
      if (batch.length >= CSV_MAX_BATCH_SIZE) {
        await flush(batch)
        batch = []
      }
    }

    if (!ready) {
      // Fewer than CSV_SCHEMA_SAMPLE_SIZE rows total (or zero).
      if (sample.length === 0) {
        // No data rows — fail rather than report a successful empty import (matches the sync route).
        const message = 'CSV file has no data rows'
        await markImportFailed(tableId, message)
        void appendTableEvent({
          kind: 'import',
          tableId,
          importId,
          status: 'failed',
          error: message,
        })
        logger.warn(`[${requestId}] Import has no data rows`, { tableId, fileName })
        return
      }
      await resolveSetup()
      await flush(sample)
    } else {
      await flush(batch)
    }

    await updateImportProgress(tableId, inserted)
    await markImportReady(tableId)
    void appendTableEvent({
      kind: 'import',
      tableId,
      importId,
      status: 'ready',
      progress: inserted,
      total: inserted,
    })
    logger.info(`[${requestId}] Import complete`, { tableId, fileName, mode, rows: inserted })
  } catch (err) {
    const message = getErrorMessage(err, 'Import failed')
    logger.error(`[${requestId}] Import failed for table ${tableId}:`, err)
    await markImportFailed(tableId, message).catch(() => {})
    void appendTableEvent({ kind: 'import', tableId, importId, status: 'failed', error: message })
  }
}
