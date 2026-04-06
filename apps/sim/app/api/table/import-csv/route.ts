import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateId } from '@/lib/core/utils/uuid'
import {
  batchInsertRows,
  createTable,
  deleteTable,
  getWorkspaceTableLimits,
  type TableSchema,
} from '@/lib/table'
import type { ColumnDefinition, RowData } from '@/lib/table/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableImportCSV')

const MAX_CSV_FILE_SIZE = 50 * 1024 * 1024
const MAX_BATCH_SIZE = 1000
const SCHEMA_SAMPLE_SIZE = 100

type ColumnType = 'string' | 'number' | 'boolean' | 'date'

async function parseCsvBuffer(
  buffer: Buffer,
  delimiter = ','
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const { parse } = await import('csv-parse/sync')
  const parsed = parse(buffer.toString('utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
    cast: false,
    delimiter,
  }) as Record<string, unknown>[]

  if (parsed.length === 0) {
    throw new Error('CSV file has no data rows')
  }

  const headers = Object.keys(parsed[0])
  if (headers.length === 0) {
    throw new Error('CSV file has no headers')
  }

  return { headers, rows: parsed }
}

function inferColumnType(values: unknown[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (nonEmpty.length === 0) return 'string'

  const allNumber = nonEmpty.every((v) => {
    const n = Number(v)
    return !Number.isNaN(n) && String(v).trim() !== ''
  })
  if (allNumber) return 'number'

  const allBoolean = nonEmpty.every((v) => {
    const s = String(v).toLowerCase()
    return s === 'true' || s === 'false'
  })
  if (allBoolean) return 'boolean'

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/
  const allDate = nonEmpty.every((v) => {
    const s = String(v)
    return isoDatePattern.test(s) && !Number.isNaN(Date.parse(s))
  })
  if (allDate) return 'date'

  return 'string'
}

function inferSchema(headers: string[], rows: Record<string, unknown>[]): ColumnDefinition[] {
  const sample = rows.slice(0, SCHEMA_SAMPLE_SIZE)
  const seen = new Set<string>()

  return headers.map((name) => {
    let colName = sanitizeName(name)
    let suffix = 2
    while (seen.has(colName.toLowerCase())) {
      colName = `${sanitizeName(name)}_${suffix}`
      suffix++
    }
    seen.add(colName.toLowerCase())

    return {
      name: colName,
      type: inferColumnType(sample.map((r) => r[name])),
    }
  })
}

/**
 * Strips non-alphanumeric characters (except underscore), collapses runs of
 * underscores, and ensures the name starts with a letter or underscore.
 * Used for both table names and column names to satisfy NAME_PATTERN.
 */
function sanitizeName(raw: string, fallbackPrefix = 'col'): string {
  let name = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!name || /^\d/.test(name)) {
    name = `${fallbackPrefix}_${name}`
  }

  return name
}

function coerceValue(value: unknown, colType: ColumnType): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null
  switch (colType) {
    case 'number': {
      const n = Number(value)
      return Number.isNaN(n) ? null : n
    }
    case 'boolean': {
      const s = String(value).toLowerCase()
      if (s === 'true') return true
      if (s === 'false') return false
      return null
    }
    case 'date': {
      const d = new Date(String(value))
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString()
    }
    default:
      return String(value)
  }
}

function coerceRows(
  rows: Record<string, unknown>[],
  columns: ColumnDefinition[],
  headerToColumn: Map<string, string>
): RowData[] {
  const colTypeMap = new Map(columns.map((c) => [c.name, c.type as ColumnType]))

  return rows.map((row) => {
    const coerced: RowData = {}
    for (const [header, value] of Object.entries(row)) {
      const colName = headerToColumn.get(header)
      if (colName) {
        coerced[colName] = coerceValue(value, colTypeMap.get(colName) ?? 'string')
      }
    }
    return coerced
  })
}

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

    if (file.size > MAX_CSV_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size of ${MAX_CSV_FILE_SIZE / (1024 * 1024)} MB` },
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

    const columns = inferSchema(headers, rows)
    const headerToColumn = new Map(headers.map((h, i) => [h, columns[i].name]))

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
      const coerced = coerceRows(rows, columns, headerToColumn)
      let inserted = 0
      for (let i = 0; i < coerced.length; i += MAX_BATCH_SIZE) {
        const batch = coerced.slice(i, i + MAX_BATCH_SIZE)
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
