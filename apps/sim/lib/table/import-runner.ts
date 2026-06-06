import { type Readable, Transform } from 'node:stream'
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
  nextImportStartOrderKey,
  nextImportStartPosition,
  setTableSchemaForImport,
  updateImportProgress,
} from '@/lib/table/service'
import { deleteFile, downloadFileStream, headObject } from '@/lib/uploads/core/storage-service'
import { normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableImportRunner')

/** Emit a progress event / DB update at most every this many rows. */
const PROGRESS_INTERVAL_ROWS = 5000

/**
 * Thrown when this worker discovers it no longer owns the table's import (the stale-job janitor
 * marked its run failed and a newer import took over). The worker stops inserting rather than
 * writing into a table a second worker now owns.
 */
class ImportSupersededError extends Error {}

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
  // Hoisted so `finally` can destroy it on any failure — otherwise the storage HTTP body leaks
  // open until it times out.
  let source: Readable | undefined

  try {
    const loaded = await getTableById(tableId, { includeArchived: true })
    if (!loaded) throw new Error(`Import target table ${tableId} not found`)
    const table = loaded

    // Total byte size for the progress estimate — a cheap HEAD, no download. May be null on
    // the local dev provider, in which case the bar stays indeterminate (rows still show).
    const totalBytes = (await headObject(fileKey, 'workspace'))?.size ?? 0

    // Stream the file rather than buffering it — a ~1M-row import must never be held in memory.
    source = await downloadFileStream({ key: fileKey, context: 'workspace' })

    // Append must continue after the existing rows; create/replace start empty. Read once up
    // front (the import is the table's sole writer) and assign contiguous positions / threaded
    // order keys from it.
    const basePosition = mode === 'append' ? await nextImportStartPosition(tableId) : 0
    let lastOrderKey = mode === 'append' ? await nextImportStartOrderKey(tableId) : null

    // Count bytes as they flow so the row total can be extrapolated from byte progress.
    let bytesRead = 0
    const byteCounter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytesRead += chunk.length
        cb(null, chunk)
      },
    })

    const parser = createCsvParser(delimiter)
    // `.pipe` doesn't forward source errors; forward so the iterator throws.
    source.on('error', (err) => parser.destroy(err))
    byteCounter.on('error', (err) => parser.destroy(err))
    source.pipe(byteCounter).pipe(parser)

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

      // Replace deletes existing rows only after schema/mapping validation passes, so an
      // invalid or empty file fails the import with the old rows still intact (a mid-stream
      // insert failure after this point leaves a partial replace — replace is destructive).
      if (mode === 'replace') await deleteAllTableRows(tableId)
    }

    const flush = async (rows: Record<string, unknown>[]) => {
      if (rows.length === 0 || !schema || !headerToColumn) return
      // Ownership gate before every insert: once this run loses the table (cancel/supersede),
      // updateImportProgress returns false and we stop before writing into a table a newer import
      // may own. Runs per batch (not just at the emit cadence) so we stop within one batch.
      const owns = await updateImportProgress(tableId, inserted, importId)
      if (!owns) throw new ImportSupersededError()
      const coerced = coerceRowsForTable(rows, schema, headerToColumn)
      const result = await bulkInsertImportBatch(
        {
          tableId,
          workspaceId,
          userId,
          rows: coerced,
          startPosition: basePosition + inserted,
          afterOrderKey: lastOrderKey,
        },
        { ...table, schema },
        requestId
      )
      inserted += result.inserted
      lastOrderKey = result.lastOrderKey
      // Emit after the first batch, then every interval, so the bar appears early without flooding.
      if (
        inserted - lastReported >= PROGRESS_INTERVAL_ROWS ||
        (lastReported === 0 && inserted > 0)
      ) {
        lastReported = inserted
        // Exact, monotonic completion from bytes consumed — no wobbly row estimate.
        const percent =
          totalBytes > 0 ? Math.min(99, Math.round((bytesRead / totalBytes) * 100)) : undefined
        void appendTableEvent({
          kind: 'import',
          tableId,
          importId,
          status: 'importing',
          progress: inserted,
          percent,
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
        await markImportFailed(tableId, importId, message)
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

    await updateImportProgress(tableId, inserted, importId)
    // Only announce success if we actually won the transition — a cancel/supersede that landed
    // right at the end makes this a no-op, and we must not emit a false `ready`.
    const becameReady = await markImportReady(tableId, importId)
    if (becameReady) {
      void appendTableEvent({
        kind: 'import',
        tableId,
        importId,
        status: 'ready',
        progress: inserted,
        percent: 100,
      })
      logger.info(`[${requestId}] Import complete`, { tableId, fileName, mode, rows: inserted })
    } else {
      logger.info(
        `[${requestId}] Import finished but no longer owns the run (canceled/superseded)`,
        {
          tableId,
          importId,
        }
      )
    }
  } catch (err) {
    if (err instanceof ImportSupersededError) {
      // A newer import owns the table now — leave its status alone and just stop.
      logger.info(`[${requestId}] Import superseded by a newer run; stopping`, {
        tableId,
        importId,
      })
    } else {
      const message = getErrorMessage(err, 'Import failed')
      logger.error(`[${requestId}] Import failed for table ${tableId}:`, err)
      // Scoped to importId — a no-op if a newer import has taken over.
      await markImportFailed(tableId, importId, message).catch(() => {})
      void appendTableEvent({ kind: 'import', tableId, importId, status: 'failed', error: message })
    }
  } finally {
    // Release the storage stream so its HTTP connection doesn't leak on failure.
    source?.destroy()
    // The uploaded source file is single-use (a fresh upload per import) — delete it once the
    // import is terminal so the workspace bucket doesn't accumulate. Best-effort.
    await deleteFile({ key: fileKey, context: 'workspace' }).catch((err) => {
      logger.warn(`[${requestId}] Failed to delete imported file`, { fileKey, err })
    })
  }
}
