import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseCountRowsContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseCountRows } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseCountRowsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse count rows attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseCountRowsContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const count = await executeClickHouseCountRows(params, params.table, params.where)

    return NextResponse.json({
      message: `Table contains ${count} row(s).`,
      count,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse count rows failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse count rows failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
