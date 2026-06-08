import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseOptimizeTableContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseOptimizeTable } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseOptimizeTableAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse optimize table attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseOptimizeTableContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    await executeClickHouseOptimizeTable(params, params.table, params.final)

    return NextResponse.json({
      message: `Optimize submitted for table '${params.table}'.`,
      rows: [],
      rowCount: 0,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse optimize table failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse optimize table failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
