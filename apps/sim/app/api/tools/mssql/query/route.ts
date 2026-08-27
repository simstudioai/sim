import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mssqlQueryContract } from '@/lib/api/contracts/tools/databases/mssql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createMSSQLConnection,
  executeQuery,
  toRowsResponseBody,
  validateReadOnlyQuery,
} from '@/app/api/tools/mssql/utils'

const logger = createLogger('MSSQLQueryAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized Microsoft SQL Server query attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mssqlQueryContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Executing Microsoft SQL Server query on ${params.host}:${params.port}/${params.database}`
    )

    const validation = validateReadOnlyQuery(params.query)
    if (!validation.isValid) {
      logger.warn(`[${requestId}] Query validation failed: ${validation.error}`)
      return NextResponse.json(
        { error: `Query validation failed: ${validation.error}` },
        { status: 400 }
      )
    }

    const pool = await createMSSQLConnection(params)

    try {
      const result = await executeQuery(pool, params.query)

      logger.info(`[${requestId}] Query executed successfully, returned ${result.rowCount} rows`)

      return NextResponse.json(
        toRowsResponseBody(
          result,
          `Query executed successfully. ${result.rowCount} row(s) returned.`
        )
      )
    } finally {
      await pool.close()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Microsoft SQL Server query failed:`, error)

    return NextResponse.json(
      { error: `Microsoft SQL Server query failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
