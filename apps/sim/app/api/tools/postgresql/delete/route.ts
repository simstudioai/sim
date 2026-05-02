import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { postgresqlDeleteContract } from '@/lib/api/contracts/tools/databases/postgresql'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createPostgresConnection, executeDelete } from '@/app/api/tools/postgresql/utils'

const logger = createLogger('PostgreSQLDeleteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized PostgreSQL delete attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(postgresqlDeleteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Deleting data from ${params.table} on ${params.host}:${params.port}/${params.database}`
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
      const result = await executeDelete(sql, params.table, params.where)

      logger.info(`[${requestId}] Delete executed successfully, ${result.rowCount} row(s) deleted`)

      return NextResponse.json({
        message: `Data deleted successfully. ${result.rowCount} row(s) affected.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      await sql.end()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] PostgreSQL delete failed:`, error)

    return NextResponse.json(
      { error: `PostgreSQL delete failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
