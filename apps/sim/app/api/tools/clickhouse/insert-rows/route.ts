import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseInsertRowsContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseInsertRows } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseInsertRowsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse insert rows attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseInsertRowsContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const result = await executeClickHouseInsertRows(params, params.table, params.rows)

    return NextResponse.json({
      message: `Inserted ${result.rowCount} row(s) into '${params.table}'.`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse insert rows failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse insert rows failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
