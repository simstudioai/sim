import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createPostgresConnection, executeQuery } from '@/app/api/tools/postgresql/utils'

const logger = createLogger('PostgreSQLQueryAPI')

const QuerySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('required'),
  query: z.string().min(1, 'Query is required'),
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const params = QuerySchema.parse(body)

    logger.info(
      `[${requestId}] Executing PostgreSQL query on ${params.host}:${params.port}/${params.database}`
    )

    const sql = createPostgresConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl,
    })

    try {
      const result = await executeQuery(sql, params.query)

      logger.info(`[${requestId}] Query executed successfully, returned ${result.rowCount} rows`)

      return NextResponse.json({
        message: `Query executed successfully. ${result.rowCount} row(s) returned.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      await sql.end()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] PostgreSQL query failed:`, error)

    return NextResponse.json({ error: `PostgreSQL query failed: ${errorMessage}` }, { status: 500 })
  }
}
