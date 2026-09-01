import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  getMaxRowsPerTable,
  getWorkspaceTableLimits,
  wouldExceedRowLimit,
} from '@/lib/table/billing'
import { generateColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { sniffCsvDelimiterFromStream } from '@/lib/table/csv-delimiter-stream'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  buildAutoMapping,
  CSV_MAX_BATCH_SIZE,
  CSV_SCHEMA_SAMPLE_SIZE,
  type CsvDelimiter,
  type CsvHeaderMapping,
  CsvImportValidationError,
  type CsvRejectionSummary,
  coerceRowsForTable,
  createCsvRejectionCollector,
  inferColumnType,
  inferSchemaFromCsv,
  sanitizeName,
  validateMapping,
} from '@/lib/table/import'
import { importAppendRows, importReplaceRows } from '@/lib/table/import-data'
import { createCsvParser } from '@/lib/table/import-stream'
import {
  markTableJobRunning,
  releaseJobClaim,
  type TableImportRejectionSummary,
} from '@/lib/table/jobs/service'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { batchInsertRows, dispatchAfterBatchInsert } from '@/lib/table/rows/service'
import { createTable, deleteTable } from '@/lib/table/service'
import type { RowData, TableDefinition, TableLockKind, TableSchema } from '@/lib/table/types'

const logger = createLogger('TableImportOrchestration')

/**
 * CSV import orchestration.
 *
 * Both entry points own the whole import: they consume the caller's file
 * stream, sniff the separator, parse, map, coerce, claim the table's job slot,
 * and write. Routes are left holding only transport concerns — reading the
 * multipart body, authorizing, and rendering the result — so the v1 and v2
 * surfaces cannot drift on what an import actually does.
 */

interface ImportFailure {
  success: false
  error: string
  errorCode: OrchestrationErrorCode
  details?: unknown
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
}

function fail(error: string, errorCode: OrchestrationErrorCode, details?: unknown): ImportFailure {
  return { success: false, error, errorCode, ...(details !== undefined ? { details } : {}) }
}

/**
 * Classifies a write failure raised inside an import. A lock rejection is a
 * 423 and `TableLockedError` is not an `OrchestrationError`, so it needs its
 * own branch; anything unclassified is a server fault whose message must not
 * reach the caller.
 *
 * A lock rejection carries its `lock` kind through, because "locked" alone does
 * not tell a caller which of the four flags to clear.
 */
function classifyImportFailure(error: unknown, requestId: string, tableId: string): ImportFailure {
  if (error instanceof TableLockedError) {
    return { ...fail(error.message, 'locked'), lock: error.lock }
  }
  if (error instanceof OrchestrationError) return fail(error.message, error.code)
  logger.error(`[${requestId}] CSV import failed for table ${tableId}`, { error })
  return fail(toError(error).message, 'internal')
}

/**
 * What a synchronous import reports about the data it lost, so a partial import
 * is not rendered as a clean one — the same accounting the streaming runner
 * folds into the import record, returned inline because these paths have no
 * import record to read afterwards.
 *
 * Omitted entirely when nothing was lost, so a clean import's payload stays
 * exactly what it has always been.
 */
export interface ImportRejectionFields {
  rejections?: TableImportRejectionSummary
}

/**
 * Projects a parse summary and the coercion tally onto the field a result
 * carries, collapsing to `{}` when the import lost nothing.
 */
function rejectionFields(
  rejections: CsvRejectionSummary,
  cellsRejected: number
): ImportRejectionFields {
  if (rejections.rowsRejected === 0 && cellsRejected === 0) return {}
  return {
    rejections: {
      rowsRejected: rejections.rowsRejected,
      cellsRejected,
      rejectedSamples: rejections.rejectedSamples,
    },
  }
}

/**
 * Drains a CSV/TSV stream into memory. The extension only picks the fallback —
 * the separator is sniffed from the file's head so semicolon/pipe exports
 * (European-locale Excel) don't land in one column.
 */
async function readCsvRows(
  fileStream: Readable,
  fallbackDelimiter: CsvDelimiter
): Promise<{
  headers: string[]
  rows: Record<string, unknown>[]
  rejections: CsvRejectionSummary
}> {
  const { delimiter, stream } = await sniffCsvDelimiterFromStream(fileStream, fallbackDelimiter)

  let headers: string[] = []
  const rejections = createCsvRejectionCollector()
  const parser = createCsvParser(
    delimiter,
    (parsedHeaders) => {
      headers = parsedHeaders
    },
    rejections.onSkip
  )
  // `.pipe` doesn't forward source errors; forward them so the iterator throws.
  stream.on('error', (streamError) => parser.destroy(streamError))
  stream.pipe(parser)

  const rows: Record<string, unknown>[] = []
  for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
    rows.push(record)
  }
  return { headers, rows, rejections: rejections.summary }
}

/**
 * Resolves `createColumns` into pending column definitions plus the schema the
 * rows should be coerced against. Ids are pre-assigned so the prospective
 * schema and the columns the write actually creates share the same keys — the
 * coerced rows are keyed by id before those columns exist.
 */
function planNewColumns(
  table: TableDefinition,
  headers: string[],
  createColumns: string[],
  mapping: CsvHeaderMapping,
  rows: Record<string, unknown>[]
):
  | {
      ok: true
      additions: { id: string; name: string; type: string }[]
      schema: TableSchema
      mapping: CsvHeaderMapping
    }
  | { ok: false; failure: ImportFailure } {
  const headerSet = new Set(headers)
  const unknownHeaders = createColumns.filter((header) => !headerSet.has(header))
  if (unknownHeaders.length > 0) {
    return {
      ok: false,
      failure: fail(
        `createColumns references unknown CSV headers: ${unknownHeaders.join(', ')}`,
        'validation'
      ),
    }
  }

  const usedNames = new Set(table.schema.columns.map((column) => column.name.toLowerCase()))
  const updatedMapping: CsvHeaderMapping = { ...mapping }
  const additions: { id: string; name: string; type: string }[] = []
  const newColumns: TableSchema['columns'] = []

  for (const header of createColumns) {
    const base = sanitizeName(header)
    let columnName = base
    let suffix = 2
    while (usedNames.has(columnName.toLowerCase())) {
      columnName = `${base}_${suffix}`
      suffix++
    }
    usedNames.add(columnName.toLowerCase())
    const inferredType = inferColumnType(rows.map((row) => row[header]))
    const id = generateColumnId()
    additions.push({ id, name: columnName, type: inferredType })
    newColumns.push({
      id,
      name: columnName,
      type: inferredType as TableSchema['columns'][number]['type'],
      required: false,
      unique: false,
    })
    updatedMapping[header] = columnName
  }

  return {
    ok: true,
    additions,
    schema: { columns: [...table.schema.columns, ...newColumns] },
    mapping: updatedMapping,
  }
}

export interface PerformTableCsvImportParams {
  table: TableDefinition
  workspaceId: string
  userId: string
  /** Multipart file stream. The caller still owns destroying it. */
  fileStream: Readable
  fileName: string
  /** Separator to fall back to when sniffing is inconclusive. */
  fallbackDelimiter: CsvDelimiter
  mode: 'append' | 'replace'
  /** Explicit CSV header → column name map. Auto-derived from the schema when omitted. */
  mapping?: CsvHeaderMapping
  /** CSV headers to create as new columns on the table before importing. */
  createColumns?: string[]
  /** IANA zone used to read naive datetimes (Excel/Sheets exports carry no offset). */
  timezone: string
  requestId?: string
  /**
   * The person whose permission group gates any cell this import auto-fires,
   * or `null` when no person is behind it. An import lands rows, and landing
   * rows starts the table's workflow and enrichment cells. Threaded from the
   * surface that holds the principal — the route has already gated the same
   * subject. Required; see {@link InsertRowData.capabilityGovernedUserId} in `@/lib/table/types`.
   */
  capabilityGovernedUserId: string | null
}

export interface TableCsvImportData extends ImportRejectionFields {
  tableId: string
  mode: 'append' | 'replace'
  insertedCount: number
  /** Replace mode only — rows removed before the insert. */
  deletedCount?: number
  mappedColumns: string[]
  skippedHeaders: string[]
  unmappedColumns: string[]
  sourceFile: string
}

export interface PerformTableCsvImportResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  /** Per-header mapping issues, when the failure is a mapping validation. */
  details?: unknown
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
  data?: TableCsvImportData
}

/**
 * Imports a CSV into an EXISTING table, appending or replacing its rows.
 *
 * The table's single write-job slot is claimed for the whole write and released
 * before returning. The claim is the real concurrency gate — the `jobStatus`
 * pre-check reads a snapshot taken before the parse, and a background import
 * can start in that window; without the claim a synchronous and a background
 * import would interleave and corrupt a replace.
 */
export async function performTableCsvImport(
  params: PerformTableCsvImportParams
): Promise<PerformTableCsvImportResult> {
  const {
    table,
    workspaceId,
    userId,
    fileStream,
    fileName,
    fallbackDelimiter,
    mode,
    timezone,
    capabilityGovernedUserId,
  } = params
  const requestId = params.requestId ?? generateRequestId()

  if (table.archivedAt) return fail('Cannot import into an archived table', 'validation')
  if (table.jobStatus === 'running') {
    return fail('A job is already in progress for this table', 'conflict')
  }

  const { headers, rows, rejections } = await readCsvRows(fileStream, fallbackDelimiter)
  if (rows.length === 0) return fail('CSV file has no data rows', 'validation')

  let effectiveMapping = params.mapping ?? buildAutoMapping(headers, table.schema)
  let prospectiveSchema = table.schema
  let additions: { id: string; name: string; type: string }[] = []

  if (params.createColumns && params.createColumns.length > 0) {
    const planned = planNewColumns(table, headers, params.createColumns, effectiveMapping, rows)
    if (!planned.ok) return planned.failure
    additions = planned.additions
    prospectiveSchema = planned.schema
    effectiveMapping = planned.mapping
  }

  let validation: ReturnType<typeof validateMapping>
  try {
    validation = validateMapping({
      csvHeaders: headers,
      mapping: effectiveMapping,
      tableSchema: prospectiveSchema,
    })
  } catch (error) {
    if (error instanceof CsvImportValidationError) {
      return fail(error.message, 'validation', error.details)
    }
    throw error
  }

  if (validation.mappedHeaders.length === 0) {
    return fail(
      `No CSV headers map to columns on the table. CSV headers: ${headers.join(', ')}. Table columns: ${prospectiveSchema.columns
        .map((column) => column.name)
        .join(', ')}`,
      'validation'
    )
  }

  let cellsRejected = 0
  const coerced = coerceRowsForTable(
    rows,
    prospectiveSchema,
    validation.effectiveMap,
    { timezone },
    () => {
      cellsRejected++
    }
  )
  const rejected = rejectionFields(rejections, cellsRejected)
  if (rejected.rejections) {
    logger.warn(`[${requestId}] CSV import lost source data`, {
      tableId: table.id,
      fileName,
      ...rejected.rejections,
    })
  }

  const importId = generateId()
  if (!(await markTableJobRunning(table.id, importId, 'import'))) {
    return fail('A job is already in progress for this table', 'conflict')
  }

  const summary = {
    tableId: table.id,
    mode,
    mappedColumns: validation.mappedHeaders,
    skippedHeaders: validation.skippedHeaders,
    unmappedColumns: validation.unmappedColumns,
    sourceFile: fileName,
    ...rejected,
  }

  try {
    if (mode === 'append') {
      const maxRows = await getMaxRowsPerTable(workspaceId)
      if (wouldExceedRowLimit(maxRows, table.rowCount, coerced.length)) {
        const deficit = table.rowCount + coerced.length - maxRows
        return fail(
          `Append would exceed table row limit (${maxRows}). Currently ${table.rowCount} rows, ${coerced.length} new rows, ${deficit} over.`,
          'validation'
        )
      }

      const { inserted, table: finalTable } = await importAppendRows(table, additions, coerced, {
        workspaceId,
        userId,
        requestId,
        capabilityGovernedUserId,
      })
      // Fire trigger + scheduler AFTER the tx commits — both read through the
      // global db connection and would otherwise see no rows.
      dispatchAfterBatchInsert(finalTable, inserted, requestId, userId, capabilityGovernedUserId)

      logger.info(`[${requestId}] Append CSV imported`, {
        tableId: table.id,
        fileName,
        inserted: inserted.length,
        createdColumns: additions.length,
      })
      signalTableSchemaChanged(table.id)

      return { success: true, data: { ...summary, insertedCount: inserted.length } }
    }

    const result = await importReplaceRows(
      table,
      additions,
      { rows: coerced, workspaceId, userId },
      requestId
    )

    logger.info(`[${requestId}] Replace CSV imported`, {
      tableId: table.id,
      fileName,
      deleted: result.deletedCount,
      inserted: result.insertedCount,
      createdColumns: additions.length,
    })
    signalTableSchemaChanged(table.id)

    return {
      success: true,
      data: {
        ...summary,
        insertedCount: result.insertedCount,
        deletedCount: result.deletedCount,
      },
    }
  } catch (error) {
    return classifyImportFailure(error, requestId, table.id)
  } finally {
    // Release before returning, so a client refetch never observes the transient claim.
    await releaseJobClaim(table.id, importId).catch(() => {})
  }
}

export interface PerformCreateTableFromCsvParams {
  workspaceId: string
  userId: string
  /**
   * The person whose permission group gates any cell this import auto-fires,
   * or `null` when no person is behind it. An import lands rows, and landing
   * rows starts the table's workflow and enrichment cells. Threaded from the
   * surface that holds the principal — the route has already gated the same
   * subject. Required; see {@link InsertRowData.capabilityGovernedUserId} in `@/lib/table/types`.
   */
  capabilityGovernedUserId: string | null

  /** Multipart file stream. The caller still owns destroying it. */
  fileStream: Readable
  fileName: string
  fallbackDelimiter: CsvDelimiter
  /** Folder to create the table in; `null` creates it at the workspace root. */
  folderId: string | null
  timezone: string
  requestId?: string
}

export interface CreatedTableFromCsv {
  id: string
  name: string
  description: string | null
  schema: TableSchema
  rowCount: number
}

export interface PerformCreateTableFromCsvResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  /**
   * Which lock rejected the write. Set only when `errorCode` is `'locked'`, which
   * {@link classifyImportFailure} populates for either entry point. Declared even though a
   * table created by this call starts unlocked: the field is the only thing that tells a
   * caller which lock to clear, and leaving it off the type is how a 423 silently loses it.
   */
  lock?: TableLockKind
  data?: { table: CreatedTableFromCsv } & ImportRejectionFields
}

/**
 * Creates a NEW table from a CSV and streams its rows in.
 *
 * Unlike {@link performTableCsvImport} this never buffers the whole file: it
 * infers the schema from the first {@link CSV_SCHEMA_SAMPLE_SIZE} records,
 * creates the table, then inserts in batches as records arrive. A failure part
 * way through drops the half-populated table rather than leaving it behind.
 */
export async function performCreateTableFromCsv(
  params: PerformCreateTableFromCsvParams
): Promise<PerformCreateTableFromCsvResult> {
  const {
    workspaceId,
    userId,
    fileStream,
    fileName,
    fallbackDelimiter,
    folderId,
    timezone,
    capabilityGovernedUserId,
  } = params
  const requestId = params.requestId ?? generateRequestId()

  const { delimiter, stream } = await sniffCsvDelimiterFromStream(fileStream, fallbackDelimiter)

  let csvHeaders: string[] = []
  const rejections = createCsvRejectionCollector()
  let cellsRejected = 0
  const parser = createCsvParser(
    delimiter,
    (headers) => {
      csvHeaders = headers
    },
    rejections.onSkip
  )
  stream.on('error', (streamError) => parser.destroy(streamError))
  stream.pipe(parser)

  interface ImportState {
    table: TableDefinition
    schema: TableSchema
    headerToColumn: Map<string, string>
  }

  const insertRows = async (
    batch: Record<string, unknown>[],
    state: ImportState,
    currentRowCount: number
  ): Promise<number> => {
    if (batch.length === 0) return 0
    const coerced = coerceRowsForTable(
      batch,
      state.schema,
      state.headerToColumn,
      { timezone },
      () => {
        cellsRejected++
      }
    )
    const inserted = await batchInsertRows(
      {
        tableId: state.table.id,
        rows: coerced as RowData[],
        workspaceId,
        userId,
        capabilityGovernedUserId,
        secretProvenance: coerced.map(createExactEmptyTableRowSecretProvenance),
      },
      // The created table's rowCount is frozen at 0; pass the running total so the
      // per-batch capacity check sees cumulative rows, not an always-empty table.
      { ...state.table, rowCount: currentRowCount },
      generateId().slice(0, 8)
    )
    return inserted.length
  }

  /** Infer the schema from the buffered sample and create the (empty) table. */
  const buildTable = async (sampleRows: Record<string, unknown>[]): Promise<ImportState> => {
    const inferred = inferSchemaFromCsv(csvHeaders, sampleRows)
    // Inference emits only `{ name, type }`; the stored schema carries the
    // constraint flags explicitly so a later read never has to guess a default.
    const columns = inferred.columns.map((column) => ({
      ...column,
      required: false,
      unique: false,
    }))
    const planLimits = await getWorkspaceTableLimits(workspaceId)
    const tableName = sanitizeName(fileName.replace(/\.[^.]+$/, ''), 'imported_table').slice(
      0,
      TABLE_LIMITS.MAX_TABLE_NAME_LENGTH
    )
    const table = await createTable(
      {
        name: tableName,
        description: `Imported from ${fileName}`,
        schema: { columns },
        workspaceId,
        folderId,
        userId,
        maxTables: planLimits.maxTables,
      },
      requestId
    )
    // Coerce against the *created* schema so rows key by the ids `createTable`
    // assigned (the inferred schema above is id-less).
    return { table, schema: table.schema, headerToColumn: inferred.headerToColumn }
  }

  let state: ImportState | null = null
  let inserted = 0
  const sample: Record<string, unknown>[] = []
  let batch: Record<string, unknown>[] = []

  try {
    for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
      if (!state) {
        sample.push(record)
        if (sample.length >= CSV_SCHEMA_SAMPLE_SIZE) {
          state = await buildTable(sample)
          inserted += await insertRows(sample, state, inserted)
        }
        continue
      }
      batch.push(record)
      if (batch.length >= CSV_MAX_BATCH_SIZE) {
        inserted += await insertRows(batch, state, inserted)
        batch = []
      }
    }

    if (!state) {
      if (sample.length === 0) return fail('CSV file has no data rows', 'validation')
      state = await buildTable(sample)
      inserted += await insertRows(sample, state, inserted)
    } else {
      inserted += await insertRows(batch, state, inserted)
    }
  } catch (error) {
    // A half-populated table from a mid-stream failure is worse than none.
    if (state) await deleteTable(state.table.id, requestId).catch(() => {})
    return classifyImportFailure(error, requestId, state?.table.id ?? 'unknown')
  }

  logger.info(`[${requestId}] CSV imported`, {
    tableId: state.table.id,
    fileName,
    columns: state.schema.columns.length,
    rows: inserted,
  })

  const rejected = rejectionFields(rejections.summary, cellsRejected)
  if (rejected.rejections) {
    logger.warn(`[${requestId}] CSV import lost source data`, {
      tableId: state.table.id,
      fileName,
      ...rejected.rejections,
    })
  }

  return {
    success: true,
    data: {
      table: {
        id: state.table.id,
        name: state.table.name,
        description: state.table.description ?? null,
        schema: state.schema,
        rowCount: inserted,
      },
      ...rejected,
    },
  }
}
