import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseQueryContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseQuery } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseQueryAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse query attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseQueryContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Executing ClickHouse query on ${params.host}:${params.port}/${params.database}`
    )

    const result = await executeClickHouseQuery(params, params.query, { enforceReadOnly: true })

    logger.info(`[${requestId}] Query executed successfully, returned ${result.rowCount} rows`)

    return NextResponse.json({
      message: `Query executed successfully. ${result.rowCount} row(s) returned.`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse query failed:`, error)

    return NextResponse.json({ error: `ClickHouse query failed: ${errorMessage}` }, { status: 500 })
  }
})
