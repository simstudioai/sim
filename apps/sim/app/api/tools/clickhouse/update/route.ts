import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseUpdateContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseUpdate } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseUpdateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse update attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseUpdateContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Updating data in ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    const result = await executeClickHouseUpdate(params, params.table, params.data, params.where)

    logger.info(`[${requestId}] Update mutation submitted, ${result.rowCount} row(s) written`)

    return NextResponse.json({
      message: `Update mutation submitted. ClickHouse mutations run asynchronously. ${result.rowCount} row(s) written.`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse update failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse update failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
