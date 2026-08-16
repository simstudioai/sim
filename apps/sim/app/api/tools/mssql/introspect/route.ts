import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mssqlIntrospectContract } from '@/lib/api/contracts/tools/databases/mssql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createMSSQLConnection, executeIntrospect } from '@/app/api/tools/mssql/utils'

const logger = createLogger('MSSQLIntrospectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized Microsoft SQL Server introspect attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(mssqlIntrospectContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Introspecting Microsoft SQL Server schema on ${params.host}:${params.port}/${params.database}`
    )

    const pool = await createMSSQLConnection(params)

    try {
      const result = await executeIntrospect(pool, params.schema)

      logger.info(
        `[${requestId}] Introspection completed successfully, found ${result.tables.length} tables`
      )

      return NextResponse.json({
        message: `Schema introspection completed. Found ${result.tables.length} table(s) in schema '${params.schema}'.`,
        tables: result.tables,
        schemas: result.schemas,
      })
    } finally {
      await pool.close()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Microsoft SQL Server introspection failed:`, error)

    return NextResponse.json(
      { error: `Microsoft SQL Server introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
