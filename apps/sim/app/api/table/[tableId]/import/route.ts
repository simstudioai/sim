import type { Readable } from 'node:stream'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import {
  csvExtensionSchema,
  csvImportCreateColumnsSchema,
  csvImportFormSchema,
  csvImportMappingSchema,
  csvImportModeSchema,
  tableIdParamsSchema,
} from '@/lib/api/contracts/tables'
import { getValidationErrorMessage } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isMultipartError, readMultipart } from '@/lib/core/utils/multipart'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  addTableColumnsWithTx,
  batchInsertRowsWithTx,
  buildAutoMapping,
  CSV_MAX_BATCH_SIZE,
  CSV_MAX_FILE_SIZE_BYTES,
  type CsvHeaderMapping,
  CsvImportValidationError,
  coerceRowsForTable,
  createCsvParser,
  inferColumnType,
  replaceTableRowsWithTx,
  sanitizeName,
  type TableDefinition,
  type TableSchema,
  validateMapping,
} from '@/lib/table'
import {
  accessError,
  checkAccess,
  csvProxyBodyCapResponse,
  multipartErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableImportCSVExisting')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface RouteParams {
  params: Promise<{ tableId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = tableIdParamsSchema.parse(await params)
  let fileStream: Readable | undefined

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

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

    const rawMode = fields.mode ?? 'append'
    const modeValidation = csvImportModeSchema.safeParse(rawMode)
    if (!modeValidation.success) {
      return NextResponse.json(
        { error: `Invalid mode "${String(rawMode)}". Must be "append" or "replace".` },
        { status: 400 }
      )
    }
    const mode = modeValidation.data

    const ext = file.filename.split('.').pop()?.toLowerCase()
    const extensionValidation = csvExtensionSchema.safeParse(ext)
    if (!extensionValidation.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(extensionValidation.error) },
        { status: 400 }
      )
    }

    const accessResult = await checkAccess(tableId, authResult.userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (table.workspaceId !== workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    if (table.archivedAt) {
      return NextResponse.json({ error: 'Cannot import into an archived table' }, { status: 400 })
    }

    let mapping: CsvHeaderMapping | undefined
    if (fields.mapping) {
      const mappingValidation = csvImportMappingSchema.safeParse(fields.mapping)
      if (!mappingValidation.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(mappingValidation.error) },
          { status: 400 }
        )
      }
      mapping = mappingValidation.data
    }

    let createColumns: string[] | undefined
    if (fields.createColumns) {
      const createColumnsValidation = csvImportCreateColumnsSchema.safeParse(fields.createColumns)
      if (!createColumnsValidation.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(createColumnsValidation.error) },
          { status: 400 }
        )
      }
      createColumns = createColumnsValidation.data
    }

    const delimiter = extensionValidation.data === 'tsv' ? '\t' : ','
    const parser = createCsvParser(delimiter)
    // `.pipe` doesn't forward source errors; forward them so the iterator throws.
    file.stream.on('error', (streamErr) => parser.destroy(streamErr))
    file.stream.pipe(parser)
    const rows: Record<string, unknown>[] = []
    for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
      rows.push(record)
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'CSV file has no data rows' }, { status: 400 })
    }
    const headers = Object.keys(rows[0])

    let effectiveMapping = mapping ?? buildAutoMapping(headers, table.schema)
    let prospectiveTable: TableDefinition = table
    const additions: { name: string; type: string }[] = []

    if (createColumns && createColumns.length > 0) {
      const headerSet = new Set(headers)
      const unknownHeaders = createColumns.filter((h) => !headerSet.has(h))
      if (unknownHeaders.length > 0) {
        return NextResponse.json(
          {
            error: `createColumns references unknown CSV headers: ${unknownHeaders.join(', ')}`,
          },
          { status: 400 }
        )
      }

      const usedNames = new Set(table.schema.columns.map((c) => c.name.toLowerCase()))
      const updatedMapping: CsvHeaderMapping = { ...effectiveMapping }
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
        const inferredType = inferColumnType(rows.map((r) => r[header]))
        additions.push({ name: columnName, type: inferredType })
        newColumns.push({
          name: columnName,
          type: inferredType as TableSchema['columns'][number]['type'],
          required: false,
          unique: false,
        })
        updatedMapping[header] = columnName
      }

      prospectiveTable = {
        ...table,
        schema: { columns: [...table.schema.columns, ...newColumns] },
      }
      effectiveMapping = updatedMapping
    }

    let validation: ReturnType<typeof validateMapping>
    try {
      validation = validateMapping({
        csvHeaders: headers,
        mapping: effectiveMapping,
        tableSchema: prospectiveTable.schema,
      })
    } catch (err) {
      if (err instanceof CsvImportValidationError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: 400 })
      }
      throw err
    }

    if (validation.mappedHeaders.length === 0) {
      return NextResponse.json(
        {
          error: `No CSV headers map to columns on the table. CSV headers: ${headers.join(', ')}. Table columns: ${prospectiveTable.schema.columns.map((c) => c.name).join(', ')}`,
        },
        { status: 400 }
      )
    }

    const coerced = coerceRowsForTable(rows, prospectiveTable.schema, validation.effectiveMap)

    if (mode === 'append') {
      if (prospectiveTable.rowCount + coerced.length > prospectiveTable.maxRows) {
        const deficit = prospectiveTable.rowCount + coerced.length - prospectiveTable.maxRows
        return NextResponse.json(
          {
            error: `Append would exceed table row limit (${prospectiveTable.maxRows}). Currently ${prospectiveTable.rowCount} rows, ${coerced.length} new rows, ${deficit} over.`,
          },
          { status: 400 }
        )
      }

      try {
        const inserted = await db.transaction(async (trx) => {
          let working = table
          if (additions.length > 0) {
            working = await addTableColumnsWithTx(trx, table, additions, requestId)
          }

          let total = 0
          for (let i = 0; i < coerced.length; i += CSV_MAX_BATCH_SIZE) {
            const batch = coerced.slice(i, i + CSV_MAX_BATCH_SIZE)
            const batchRequestId = generateId().slice(0, 8)
            const result = await batchInsertRowsWithTx(
              trx,
              {
                tableId: working.id,
                rows: batch,
                workspaceId,
                userId: authResult.userId,
              },
              working,
              batchRequestId
            )
            total += result.length
          }
          return total
        })

        logger.info(`[${requestId}] Append CSV imported`, {
          tableId: table.id,
          fileName: file.filename,
          mode,
          inserted,
          createdColumns: additions.length,
          mappedColumns: validation.mappedHeaders.length,
          skippedHeaders: validation.skippedHeaders.length,
        })

        return NextResponse.json({
          success: true,
          data: {
            tableId: table.id,
            mode,
            insertedCount: inserted,
            mappedColumns: validation.mappedHeaders,
            skippedHeaders: validation.skippedHeaders,
            unmappedColumns: validation.unmappedColumns,
            sourceFile: file.filename,
          },
        })
      } catch (err) {
        const message = toError(err).message
        logger.warn(`[${requestId}] Append failed for table ${tableId}`, {
          total: coerced.length,
          createdColumns: additions.length,
          error: message,
        })
        const isClientError =
          message.includes('row limit') ||
          message.includes('Insufficient capacity') ||
          message.includes('Schema validation') ||
          message.includes('must be unique') ||
          message.includes('Row size exceeds') ||
          message.includes('already exists') ||
          message.includes('Invalid column name') ||
          /^Row \d+:/.test(message)
        return NextResponse.json(
          {
            error: isClientError ? message : 'Failed to import CSV',
            data: { insertedCount: 0 },
          },
          { status: isClientError ? 400 : 500 }
        )
      }
    }

    try {
      const result = await db.transaction(async (trx) => {
        let working = table
        if (additions.length > 0) {
          working = await addTableColumnsWithTx(trx, table, additions, requestId)
        }
        return replaceTableRowsWithTx(
          trx,
          { tableId: working.id, rows: coerced, workspaceId, userId: authResult.userId },
          working,
          requestId
        )
      })

      logger.info(`[${requestId}] Replace CSV imported`, {
        tableId: table.id,
        fileName: file.filename,
        mode,
        deleted: result.deletedCount,
        inserted: result.insertedCount,
        createdColumns: additions.length,
        mappedColumns: validation.mappedHeaders.length,
      })

      return NextResponse.json({
        success: true,
        data: {
          tableId: table.id,
          mode,
          deletedCount: result.deletedCount,
          insertedCount: result.insertedCount,
          mappedColumns: validation.mappedHeaders,
          skippedHeaders: validation.skippedHeaders,
          unmappedColumns: validation.unmappedColumns,
          sourceFile: file.filename,
        },
      })
    } catch (err) {
      const message = toError(err).message
      const isClientError =
        message.includes('row limit') ||
        message.includes('Schema validation') ||
        message.includes('must be unique') ||
        message.includes('Row size exceeds') ||
        message.includes('already exists') ||
        message.includes('Invalid column name') ||
        /^Row \d+:/.test(message)
      if (isClientError) {
        return NextResponse.json({ error: message }, { status: 400 })
      }
      throw err
    }
  } catch (error) {
    if (isMultipartError(error)) return multipartErrorResponse(error)

    const message = toError(error).message
    logger.error(`[${requestId}] CSV import into existing table failed:`, error)

    const isClientError =
      message.includes('CSV file has no') ||
      message.includes('already exists') ||
      message.includes('Invalid column name')

    return NextResponse.json(
      { error: isClientError ? message : 'Failed to import CSV' },
      { status: isClientError ? 400 : 500 }
    )
  } finally {
    fileStream?.destroy()
  }
})
