import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mssqlDeleteContract } from '@/lib/api/contracts/tools/databases/mssql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  buildDeleteQuery,
  createMSSQLConnection,
  executeQuery,
  toRowsResponseBody,
} from '@/app/api/tools/mssql/utils'

const logger = createLogger('MSSQLDeleteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized Microsoft SQL Server delete attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mssqlDeleteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Deleting data from ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    /**
     * Built before connecting so a rejected WHERE clause or a bad identifier
     * costs no TLS+login round trip and answers 400 like the query and execute
     * routes, rather than falling through to the catch-all as a 500.
     */
    let built: { query: string; values: unknown[] }
    try {
      built = buildDeleteQuery(params.table, params.where)
    } catch (error) {
      const message = getErrorMessage(error, 'Invalid statement')
      logger.warn(`[${requestId}] Delete statement rejected: ${message}`)
      return NextResponse.json(
        { error: `Microsoft SQL Server delete failed: ${message}` },
        { status: 400 }
      )
    }

    const pool = await createMSSQLConnection(params)

    try {
      const result = await executeQuery(pool, built.query, built.values)

      logger.info(`[${requestId}] Delete executed successfully, ${result.rowCount} row(s) deleted`)

      return NextResponse.json(
        toRowsResponseBody(result, `Data deleted successfully. ${result.rowCount} row(s) affected.`)
      )
    } finally {
      await pool.close()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Microsoft SQL Server delete failed:`, error)

    return NextResponse.json(
      { error: `Microsoft SQL Server delete failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
