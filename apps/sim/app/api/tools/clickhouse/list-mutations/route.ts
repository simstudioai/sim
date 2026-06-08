import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseListMutationsContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseListMutations } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseListMutationsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse list mutations attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseListMutationsContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const result = await executeClickHouseListMutations(params, params.table, params.onlyRunning)

    return NextResponse.json({
      message: `Found ${result.rowCount} mutation(s).`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse list mutations failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse list mutations failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
