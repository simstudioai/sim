import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseExecuteContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseQuery } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseExecuteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse execute attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseExecuteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Executing ClickHouse statement on ${params.host}:${params.port}/${params.database}`
    )

    const result = await executeClickHouseQuery(params, params.query)

    logger.info(`[${requestId}] Statement executed successfully, ${result.rowCount} row(s)`)

    return NextResponse.json({
      message: `Statement executed successfully. ${result.rowCount} row(s) returned or affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse execute failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse execute failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
