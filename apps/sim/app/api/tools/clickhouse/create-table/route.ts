import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { clickhouseCreateTableContract } from '@/lib/api/contracts/tools/databases/clickhouse'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { executeClickHouseCreateTable } from '@/app/api/tools/clickhouse/utils'

const logger = createLogger('ClickHouseCreateTableAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized ClickHouse create table attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(clickhouseCreateTableContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    await executeClickHouseCreateTable(
      params,
      params.table,
      params.columns,
      params.engine,
      params.orderBy,
      params.partitionBy
    )

    return NextResponse.json({
      message: `Table '${params.table}' created.`,
      rows: [],
      rowCount: 0,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] ClickHouse create table failed:`, error)

    return NextResponse.json(
      { error: `ClickHouse create table failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
