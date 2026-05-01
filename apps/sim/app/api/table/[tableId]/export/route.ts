import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { tableExportFormatSchema, tableIdParamsSchema } from '@/lib/api/contracts/tables'
import { getValidationErrorMessage } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { queryRows } from '@/lib/table/service'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableExport')

const EXPORT_BATCH_SIZE = 1000

type ExportFormat = 'csv' | 'json'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId]/export - Streams the full table contents as CSV or JSON. */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = tableIdParamsSchema.parse(await params)

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const formatValidation = tableExportFormatSchema.safeParse(
    searchParams.get('format') ?? undefined
  )
  if (!formatValidation.success) {
    return NextResponse.json(
      { error: getValidationErrorMessage(formatValidation.error) },
      { status: 400 }
    )
  }
  const format: ExportFormat = formatValidation.data

  const access = await checkAccess(tableId, auth.userId, 'read')
  if (!access.ok) return accessError(access, requestId, tableId)
  const { table } = access

  const columns = table.schema.columns
  const safeName = sanitizeFilename(table.name)
  const filename = `${safeName}.${format}`

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        if (format === 'csv') {
          controller.enqueue(encoder.encode(`${toCsvRow(columns.map((c) => c.name))}\n`))
        } else {
          controller.enqueue(encoder.encode('['))
        }

        let offset = 0
        let firstJsonRow = true
        while (true) {
          const result = await queryRows(
            tableId,
            table.workspaceId,
            { limit: EXPORT_BATCH_SIZE, offset, includeTotal: false },
            requestId
          )

          for (const row of result.rows) {
            if (format === 'csv') {
              const values = columns.map((c) => formatCsvValue(row.data[c.name]))
              controller.enqueue(encoder.encode(`${toCsvRow(values)}\n`))
            } else {
              const prefix = firstJsonRow ? '' : ','
              firstJsonRow = false
              controller.enqueue(encoder.encode(prefix + JSON.stringify({ ...row.data })))
            }
          }

          if (result.rows.length < EXPORT_BATCH_SIZE) break
          offset += result.rows.length
        }

        if (format === 'json') controller.enqueue(encoder.encode(']'))
        controller.close()

        logger.info(`[${requestId}] Exported table ${tableId}`, {
          format,
          rowCount: table.rowCount,
        })
      } catch (err) {
        logger.error(`[${requestId}] Export failed for table ${tableId}`, err)
        controller.error(err)
      }
    },
  })

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'table'
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function toCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

function escapeCsvField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}
