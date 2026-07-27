import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { csvExtensionSchema, csvImportFormSchema } from '@/lib/api/contracts/tables'
import { ianaTimezoneSchema } from '@/lib/api/contracts/user'
import { getValidationErrorMessage } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isMultipartError, readMultipart } from '@/lib/core/utils/multipart'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  batchInsertRows,
  CSV_MAX_BATCH_SIZE,
  CSV_MAX_FILE_SIZE_BYTES,
  CSV_SCHEMA_SAMPLE_SIZE,
  coerceRowsForTable,
  createCsvParser,
  createTable,
  deleteTable,
  getWorkspaceTableLimits,
  inferSchemaFromCsv,
  sanitizeName,
  TABLE_LIMITS,
  type TableDefinition,
  type TableSchema,
} from '@/lib/table'
import { sniffCsvDelimiterFromStream } from '@/lib/table/csv-delimiter-stream'
import { getUserSettings } from '@/lib/users/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  csvProxyBodyCapResponse,
  multipartErrorResponse,
  normalizeColumn,
  rowWriteErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableImportCSV')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  let fileStream: Readable | undefined

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userId = authResult.userId

    const oversize = csvProxyBodyCapResponse(request)
    if (oversize) return oversize

    let parsed: Awaited<ReturnType<typeof readMultipart>>
    try {
      parsed = await readMultipart(request, {
        maxFileBytes: CSV_MAX_FILE_SIZE_BYTES,
        requiredFieldsBeforeFile: ['workspaceId'],
        signal: request.signal,
      })
    } catch (err) {
      if (isMultipartError(err)) return multipartErrorResponse(err)
      throw err
    }

    const { fields, file } = parsed
    if (!file) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 })
    }
    fileStream = file.stream

    const workspaceIdResult = csvImportFormSchema.shape.workspaceId.safeParse(fields.workspaceId)
    if (!workspaceIdResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(workspaceIdResult.error) },
        { status: 400 }
      )
    }
    const workspaceId = workspaceIdResult.data

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'write' && permission !== 'admin') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    let timezone = (await getUserSettings(userId)).timezone ?? 'UTC'
    if (fields.timezone) {
      const timezoneResult = ianaTimezoneSchema.safeParse(fields.timezone)
      if (!timezoneResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(timezoneResult.error) },
          { status: 400 }
        )
      }
      timezone = timezoneResult.data
    }

    const ext = file.filename.split('.').pop()?.toLowerCase()
    const extensionResult = csvExtensionSchema.safeParse(ext)
    if (!extensionResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(extensionResult.error) },
        { status: 400 }
      )
    }
    // The extension only picks the fallback — the separator is sniffed from the file's
    // head so semicolon/pipe exports (European-locale Excel) don't land in one column.
    const { delimiter, stream: csvStream } = await sniffCsvDelimiterFromStream(
      file.stream,
      extensionResult.data === 'tsv' ? '\t' : ','
    )

    let csvHeaders: string[] = []
    const parser = createCsvParser(delimiter, (headers) => {
      csvHeaders = headers
    })
    // `.pipe` doesn't forward source errors; forward them so the iterator throws.
    csvStream.on('error', (err) => parser.destroy(err))
    csvStream.pipe(parser)

    interface ImportState {
      table: TableDefinition
      schema: TableSchema
      headerToColumn: Map<string, string>
    }

    const insertRows = async (
      rows: Record<string, unknown>[],
      state: ImportState,
      currentRowCount: number
    ) => {
      if (rows.length === 0) return 0
      const coerced = coerceRowsForTable(rows, state.schema, state.headerToColumn, { timezone })
      const result = await batchInsertRows(
        { tableId: state.table.id, rows: coerced, workspaceId, userId },
        // The created table's rowCount is frozen at 0; pass the running total so the
        // per-batch capacity check sees cumulative rows, not an always-empty table.
        { ...state.table, rowCount: currentRowCount },
        generateId().slice(0, 8)
      )
      return result.length
    }

    /** Infer the schema from the buffered sample and create the (empty) table. */
    const buildTable = async (sampleRows: Record<string, unknown>[]): Promise<ImportState> => {
      const inferred = inferSchemaFromCsv(csvHeaders, sampleRows)
      const schema: TableSchema = { columns: inferred.columns.map(normalizeColumn) }
      const planLimits = await getWorkspaceTableLimits(workspaceId)
      const tableName = sanitizeName(file.filename.replace(/\.[^.]+$/, ''), 'imported_table').slice(
        0,
        TABLE_LIMITS.MAX_TABLE_NAME_LENGTH
      )
      const table = await createTable(
        {
          name: tableName,
          description: `Imported from ${file.filename}`,
          schema,
          workspaceId,
          userId,
          maxTables: planLimits.maxTables,
        },
        requestId
      )
      // Coerce against the *created* schema so rows key by the ids `createTable`
      // assigned (the local `schema` is the id-less inferred one).
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
        if (sample.length === 0) {
          return NextResponse.json({ error: 'CSV file has no data rows' }, { status: 400 })
        }
        state = await buildTable(sample)
        inserted += await insertRows(sample, state, inserted)
      } else {
        inserted += await insertRows(batch, state, inserted)
      }
    } catch (streamError) {
      if (state) await deleteTable(state.table.id, requestId).catch(() => {})
      throw streamError
    }

    logger.info(`[${requestId}] CSV imported`, {
      tableId: state.table.id,
      fileName: file.filename,
      columns: state.schema.columns.length,
      rows: inserted,
    })

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: state.table.id,
          name: state.table.name,
          description: state.table.description,
          schema: state.schema,
          rowCount: inserted,
        },
      },
    })
  } catch (error) {
    if (isMultipartError(error)) return multipartErrorResponse(error)

    logger.error(`[${requestId}] CSV import failed:`, error)

    // Row-write failures (e.g. the plan row-limit check) map to a 400 with the real reason.
    const rowWriteError = rowWriteErrorResponse(error)
    if (rowWriteError) return rowWriteError

    const message = toError(error).message
    const isClientError =
      message.includes('maximum table limit') ||
      message.includes('CSV file has no') ||
      message.includes('Invalid table name') ||
      message.includes('Invalid schema') ||
      message.includes('already exists')

    return NextResponse.json(
      { error: isClientError ? message : 'Failed to import CSV' },
      { status: isClientError ? 400 : 500 }
    )
  } finally {
    fileStream?.destroy()
  }
})
