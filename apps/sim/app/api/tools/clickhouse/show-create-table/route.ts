import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseShowCreateTableContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseShowCreateTable } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseShowCreateTableAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse show create table attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseShowCreateTableContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const ddl = await executeClickHouseShowCreateTable(params, params.table)

    return NextResponse.json({
      message: 'Retrieved CREATE statement.',
      ddl,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse show create table failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse show create table failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
