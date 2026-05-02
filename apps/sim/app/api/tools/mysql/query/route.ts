import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mysqlQueryContract } from '@/lib/api/contracts/tools/databases/mysql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createMySQLConnection, executeQuery, validateQuery } from '@/app/api/tools/mysql/utils'

const logger = createLogger('MySQLQueryAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized MySQL query attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mysqlQueryContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Executing MySQL query on ${params.host}:${params.port}/${params.database}`
    )

    const validation = validateQuery(params.query)
    if (!validation.isValid) {
      logger.warn(`[${requestId}] Query validation failed: ${validation.error}`)
      return NextResponse.json(
        { error: `Query validation failed: ${validation.error}` },
        { status: 400 }
      )
    }

    const connection = await createMySQLConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl,
    })

    try {
      const result = await executeQuery(connection, params.query)

      logger.info(`[${requestId}] Query executed successfully, returned ${result.rowCount} rows`)

      return NextResponse.json({
        message: `Query executed successfully. ${result.rowCount} row(s) returned.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      await connection.end()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MySQL query failed:`, error)

    return NextResponse.json({ error: `MySQL query failed: ${errorMessage}` }, { status: 500 })
  }
})
