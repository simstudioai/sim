import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mysqlIntrospectContract } from '@/lib/api/contracts/tools/databases/mysql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createMySQLConnection, executeIntrospect } from '@/app/api/tools/mysql/utils'

const logger = createLogger('MySQLIntrospectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized MySQL introspect attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mysqlIntrospectContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Introspecting MySQL schema on ${params.host}:${params.port}/${params.database}`
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
      const result = await executeIntrospect(connection, params.database)

      logger.info(
        `[${requestId}] Introspection completed successfully, found ${result.tables.length} tables`
      )

      return NextResponse.json({
        message: `Schema introspection completed. Found ${result.tables.length} table(s) in database '${params.database}'.`,
        tables: result.tables,
        databases: result.databases,
      })
    } finally {
      await connection.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] MySQL introspection failed:`, error)

    return NextResponse.json(
      { error: `MySQL introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
