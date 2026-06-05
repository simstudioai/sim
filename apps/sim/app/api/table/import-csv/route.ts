import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { csvExtensionSchema, csvImportFormSchema } from '@/lib/api/contracts/tables'
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
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  csvProxyBodyCapResponse,
  multipartErrorResponse,
  normalizeColumn,
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

    const ext = file.filename.split('.').pop()?.toLowerCase()
    const extensionResult = csvExtensionSchema.safeParse(ext)
    if (!extensionResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(extensionResult.error) },
        { status: 400 }
      )
    }
    const delimiter = extensionResult.data === 'tsv' ? '\t' : ','

    const parser = createCsvParser(delimiter)
    // `.pipe` doesn't forward source errors; forward them so the iterator throws.
    file.stream.on('error', (err) => parser.destroy(err))
    file.stream.pipe(parser)

    interface ImportState {
      table: TableDefinition
      schema: TableSchema
      headerToColumn: Map<string, string>
    }

    const insertRows = async (rows: Record<string, unknown>[], state: ImportState) => {
      if (rows.length === 0) return 0
      const coerced = coerceRowsForTable(rows, state.schema, state.headerToColumn)
      const result = await batchInsertRows(
        { tableId: state.table.id, rows: coerced, workspaceId, userId },
        state.table,
        generateId().slice(0, 8)
      )
      return result.length
    }

    /** Infer the schema from the buffered sample and create the (empty) table. */
    const buildTable = async (sampleRows: Record<string, unknown>[]): Promise<ImportState> => {
      const inferred = inferSchemaFromCsv(Object.keys(sampleRows[0]), sampleRows)
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
          maxRows: planLimits.maxRowsPerTable,
          maxTables: planLimits.maxTables,
        },
        requestId
      )
      return { table, schema, headerToColumn: inferred.headerToColumn }
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
            inserted += await insertRows(sample, state)
          }
          continue
        }
        batch.push(record)
        if (batch.length >= CSV_MAX_BATCH_SIZE) {
          inserted += await insertRows(batch, state)
          batch = []
        }
      }

      if (!state) {
        if (sample.length === 0) {
          return NextResponse.json({ error: 'CSV file has no data rows' }, { status: 400 })
        }
        state = await buildTable(sample)
        inserted += await insertRows(sample, state)
      } else {
        inserted += await insertRows(batch, state)
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

    const message = toError(error).message
    logger.error(`[${requestId}] CSV import failed:`, error)

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
