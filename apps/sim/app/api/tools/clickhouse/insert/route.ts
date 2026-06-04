import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseInsertContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseInsert } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseInsertAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse insert attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseInsertContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Inserting data into ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    const result = await executeClickHouseInsert(params, params.table, params.data)

    logger.info(`[${requestId}] Insert executed successfully, ${result.rowCount} row(s) inserted`)

    return NextResponse.json({
      message: `Data inserted successfully. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse insert failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse insert failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
