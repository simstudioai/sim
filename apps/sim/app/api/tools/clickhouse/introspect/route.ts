import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseIntrospectContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseIntrospect } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseIntrospectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse introspect attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseIntrospectContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Introspecting ClickHouse schema on ${params.host}:${params.port}/${params.database}`
    )

    const result = await executeClickHouseIntrospect(params)

    logger.info(
      `[${requestId}] Introspection completed successfully, found ${result.tables.length} tables`
    )

    return NextResponse.json({
      message: `Schema introspection completed. Found ${result.tables.length} table(s) in database '${params.database}'.`,
      tables: result.tables,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse introspection failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
