import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { toError } from '@/lib/core/utils/helpers'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateId } from '@/lib/core/utils/uuid'
import {
  batchInsertRows,
  buildAutoMapping,
  CSV_MAX_BATCH_SIZE,
  CSV_MAX_FILE_SIZE_BYTES,
  type CsvHeaderMapping,
  CsvImportValidationError,
  coerceRowsForTable,
  parseCsvBuffer,
  replaceTableRows,
  validateMapping,
} from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableImportCSVExisting')

const IMPORT_MODES = new Set(['append', 'replace'])

interface RouteParams {
  params: Promise<{ tableId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const workspaceId = formData.get('workspaceId') as string | null
    const rawMode = (formData.get('mode') as string | null) ?? 'append'
    const rawMapping = formData.get('mapping') as string | null

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 })
    }

    if (file.size > CSV_MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File exceeds maximum allowed size of ${CSV_MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
        },
        { status: 400 }
      )
    }

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    if (!IMPORT_MODES.has(rawMode)) {
      return NextResponse.json(
        { error: `Invalid mode "${rawMode}". Must be "append" or "replace".` },
        { status: 400 }
      )
    }
    const mode = rawMode as 'append' | 'replace'

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'tsv') {
      return NextResponse.json({ error: 'Only CSV and TSV files are supported' }, { status: 400 })
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
    if (rawMapping) {
      try {
        const parsed = JSON.parse(rawMapping)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return NextResponse.json(
            { error: 'mapping must be a JSON object mapping CSV headers to column names' },
            { status: 400 }
          )
        }
        mapping = parsed as CsvHeaderMapping
      } catch {
        return NextResponse.json({ error: 'mapping must be valid JSON' }, { status: 400 })
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const delimiter = ext === 'tsv' ? '\t' : ','
    const { headers, rows } = await parseCsvBuffer(buffer, delimiter)

    const effectiveMapping = mapping ?? buildAutoMapping(headers, table.schema)

    let validation: ReturnType<typeof validateMapping>
    try {
      validation = validateMapping({
        csvHeaders: headers,
        mapping: effectiveMapping,
        tableSchema: table.schema,
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
          error: `No CSV headers map to columns on the table. CSV headers: ${headers.join(', ')}. Table columns: ${table.schema.columns.map((c) => c.name).join(', ')}`,
        },
        { status: 400 }
      )
    }

    const coerced = coerceRowsForTable(rows, table.schema, validation.effectiveMap)

    if (mode === 'append') {
      if (table.rowCount + coerced.length > table.maxRows) {
        const deficit = table.rowCount + coerced.length - table.maxRows
        return NextResponse.json(
          {
            error: `Append would exceed table row limit (${table.maxRows}). Currently ${table.rowCount} rows, ${coerced.length} new rows, ${deficit} over.`,
          },
          { status: 400 }
        )
      }

      let inserted = 0
      try {
        for (let i = 0; i < coerced.length; i += CSV_MAX_BATCH_SIZE) {
          const batch = coerced.slice(i, i + CSV_MAX_BATCH_SIZE)
          const batchRequestId = generateId().slice(0, 8)
          const result = await batchInsertRows(
            {
              tableId: table.id,
              rows: batch,
              workspaceId,
              userId: authResult.userId,
            },
            table,
            batchRequestId
          )
          inserted += result.length
        }
      } catch (err) {
        const message = toError(err).message
        logger.warn(`[${requestId}] Append failed mid-import for table ${tableId}`, {
          inserted,
          total: coerced.length,
          error: message,
        })
        const isClientError =
          message.includes('row limit') ||
          message.includes('Insufficient capacity') ||
          message.includes('Schema validation') ||
          message.includes('must be unique') ||
          message.includes('Row size exceeds') ||
          /^Row \d+:/.test(message)
        return NextResponse.json(
          {
            error: isClientError ? message : 'Failed to import CSV',
            data: { insertedCount: inserted },
          },
          { status: isClientError ? 400 : 500 }
        )
      }

      logger.info(`[${requestId}] Append CSV imported`, {
        tableId: table.id,
        fileName: file.name,
        mode,
        inserted,
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
          sourceFile: file.name,
        },
      })
    }

    try {
      const result = await replaceTableRows(
        { tableId: table.id, rows: coerced, workspaceId, userId: authResult.userId },
        table,
        requestId
      )

      logger.info(`[${requestId}] Replace CSV imported`, {
        tableId: table.id,
        fileName: file.name,
        mode,
        deleted: result.deletedCount,
        inserted: result.insertedCount,
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
          sourceFile: file.name,
        },
      })
    } catch (err) {
      const message = toError(err).message
      const isClientError =
        message.includes('row limit') ||
        message.includes('Schema validation') ||
        message.includes('must be unique') ||
        message.includes('Row size exceeds') ||
        /^Row \d+:/.test(message)
      if (isClientError) {
        return NextResponse.json({ error: message }, { status: 400 })
      }
      throw err
    }
  } catch (error) {
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
  }
}
