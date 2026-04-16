import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateId } from '@/lib/core/utils/uuid'
import {
  batchInsertRows,
  CSV_MAX_BATCH_SIZE,
  CSV_MAX_FILE_SIZE_BYTES,
  coerceRowsForTable,
  createTable,
  deleteTable,
  getWorkspaceTableLimits,
  inferSchemaFromCsv,
  parseCsvBuffer,
  sanitizeName,
  type TableSchema,
} from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableImportCSV')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const workspaceId = formData.get('workspaceId') as string | null

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

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (permission !== 'write' && permission !== 'admin') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'tsv') {
      return NextResponse.json({ error: 'Only CSV and TSV files are supported' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const delimiter = ext === 'tsv' ? '\t' : ','
    const { headers, rows } = await parseCsvBuffer(buffer, delimiter)

    const { columns, headerToColumn } = inferSchemaFromCsv(headers, rows)
    const tableName = sanitizeName(file.name.replace(/\.[^.]+$/, ''), 'imported_table')
    const planLimits = await getWorkspaceTableLimits(workspaceId)

    const normalizedSchema: TableSchema = {
      columns: columns.map(normalizeColumn),
    }

    const table = await createTable(
      {
        name: tableName,
        description: `Imported from ${file.name}`,
        schema: normalizedSchema,
        workspaceId,
        userId: authResult.userId,
        maxRows: planLimits.maxRowsPerTable,
        maxTables: planLimits.maxTables,
      },
      requestId
    )

    try {
      const coerced = coerceRowsForTable(rows, normalizedSchema, headerToColumn)
      let inserted = 0
      for (let i = 0; i < coerced.length; i += CSV_MAX_BATCH_SIZE) {
        const batch = coerced.slice(i, i + CSV_MAX_BATCH_SIZE)
        const batchRequestId = generateId().slice(0, 8)
        const result = await batchInsertRows(
          { tableId: table.id, rows: batch, workspaceId, userId: authResult.userId },
          table,
          batchRequestId
        )
        inserted += result.length
      }

      logger.info(`[${requestId}] CSV imported`, {
        tableId: table.id,
        fileName: file.name,
        columns: columns.length,
        rows: inserted,
      })

      return NextResponse.json({
        success: true,
        data: {
          table: {
            id: table.id,
            name: table.name,
            description: table.description,
            schema: normalizedSchema,
            rowCount: inserted,
          },
        },
      })
    } catch (insertError) {
      await deleteTable(table.id, requestId).catch(() => {})
      throw insertError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
  }
}
