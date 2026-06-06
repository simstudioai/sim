import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseListTablesContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseListTables } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseListTablesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse list tables attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseListTablesContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const result = await executeClickHouseListTables(params)

    return NextResponse.json({
      message: `Found ${result.rowCount} table(s).`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse list tables failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse list tables failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
