import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mysqlInsertContract } from '@/lib/api/contracts/tools/databases/mysql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildInsertQuery, createMySQLConnection, executeQuery } from '@/app/api/tools/mysql/utils'

const logger = createLogger('MySQLInsertAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized MySQL insert attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mysqlInsertContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Inserting data into ${params.table} on ${params.host}:${params.port}/${params.database}`
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
      const { query, values } = buildInsertQuery(params.table, params.data)
      const result = await executeQuery(connection, query, values)

      logger.info(`[${requestId}] Insert executed successfully, ${result.rowCount} row(s) inserted`)

      return NextResponse.json({
        message: `Data inserted successfully. ${result.rowCount} row(s) affected.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      await connection.end()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MySQL insert failed:`, error)

    return NextResponse.json({ error: `MySQL insert failed: ${errorMessage}` }, { status: 500 })
  }
})
