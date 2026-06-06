import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseDeleteContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseDelete } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseDeleteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse delete attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseDeleteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Deleting data from ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    const result = await executeClickHouseDelete(params, params.table, params.where)

    logger.info(`[${requestId}] Delete mutation submitted, ${result.rowCount} row(s) affected`)

    return NextResponse.json({
      message: `Delete mutation submitted. ClickHouse mutations run asynchronously. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse delete failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse delete failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
