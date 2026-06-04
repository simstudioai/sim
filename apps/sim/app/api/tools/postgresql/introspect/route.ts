import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { postgresqlIntrospectContract } from '@/lib/api/contracts/tools/databases/postgresql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createPostgresConnection, executeIntrospect } from '@/app/api/tools/postgresql/utils'

const logger = createLogger('PostgreSQLIntrospectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized PostgreSQL introspect attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(postgresqlIntrospectContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Introspecting PostgreSQL schema on ${params.host}:${params.port}/${params.database}`
    )

    const sql = await createPostgresConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl,
    })

    try {
      const result = await executeIntrospect(sql, params.schema)

      logger.info(
        `[${requestId}] Introspection completed successfully, found ${result.tables.length} tables`
      )

      return NextResponse.json({
        message: `Schema introspection completed. Found ${result.tables.length} table(s) in schema '${params.schema}'.`,
        tables: result.tables,
        schemas: result.schemas,
      })
    } finally {
      await sql.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] PostgreSQL introspection failed:`, error)

    return NextResponse.json(
      { error: `PostgreSQL introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
