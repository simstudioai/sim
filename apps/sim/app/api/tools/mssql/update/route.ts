import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mssqlUpdateContract } from '@/lib/api/contracts/tools/databases/mssql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  buildUpdateQuery,
  createMSSQLConnection,
  executeQuery,
  toRowsResponseBody,
} from '@/app/api/tools/mssql/utils'

const logger = createLogger('MSSQLUpdateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized Microsoft SQL Server update attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mssqlUpdateContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Updating data in ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    /**
     * Built before connecting so a rejected WHERE clause or a bad identifier
     * costs no TLS+login round trip and answers 400 like the query and execute
     * routes, rather than falling through to the catch-all as a 500.
     */
    let built: { query: string; values: unknown[] }
    try {
      built = buildUpdateQuery(params.table, params.data, params.where)
    } catch (error) {
      const message = getErrorMessage(error, 'Invalid statement')
      logger.warn(`[${requestId}] Update statement rejected: ${message}`)
      return NextResponse.json(
        { error: `Microsoft SQL Server update failed: ${message}` },
        { status: 400 }
      )
    }

    const pool = await createMSSQLConnection(params)

    try {
      const result = await executeQuery(pool, built.query, built.values)

      logger.info(`[${requestId}] Update executed successfully, ${result.rowCount} row(s) updated`)

      return NextResponse.json(
        toRowsResponseBody(result, `Data updated successfully. ${result.rowCount} row(s) affected.`)
      )
    } finally {
      await pool.close()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Microsoft SQL Server update failed:`, error)

    return NextResponse.json(
      { error: `Microsoft SQL Server update failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
