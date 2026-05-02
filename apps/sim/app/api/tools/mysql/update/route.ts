import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mysqlUpdateContract } from '@/lib/api/contracts/tools/databases/mysql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildUpdateQuery, createMySQLConnection, executeQuery } from '@/app/api/tools/mysql/utils'

const logger = createLogger('MySQLUpdateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized MySQL update attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mysqlUpdateContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Updating data in ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    const connection = await createMySQLConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl,
    })

    try {
      const { query, values } = buildUpdateQuery(params.table, params.data, params.where)
      const result = await executeQuery(connection, query, values)

      logger.info(`[${requestId}] Update executed successfully, ${result.rowCount} row(s) updated`)

      return NextResponse.json({
        message: `Data updated successfully. ${result.rowCount} row(s) affected.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      await connection.end()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MySQL update failed:`, error)

    return NextResponse.json({ error: `MySQL update failed: ${errorMessage}` }, { status: 500 })
  }
})
